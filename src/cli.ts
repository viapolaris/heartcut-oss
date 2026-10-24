#!/usr/bin/env node
// heartcut CLI — thin shell over the store and pipeline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES } from './types.ts';
import type { Aspect, Project, RefRole, RunOptions, Stage } from './types.ts';
import { addRef, approveClip, chooseAsset, chooseKeyframe, removeOption, createProject, listProjects, loadProject, projectSpend, setProjectStyle, staleness } from './store.ts';
import { getStyle, listStyles, styleFor } from './styles.ts';
import { IMAGE_MODELS } from './gen/models.ts';
import { adoptEntry, importOption, listLibrary } from './library.ts';
import { isLocalAvailable, run as localRun, seedFor, LOCAL_MODELS } from './gen/local.ts';
import { getSettings } from './settings.ts';
import { LOCAL_Z, LOCAL_QWEN, localSize } from './gen/models.ts';
import { MEDIA_ROOT } from './store.ts';
import { anchorFor, anchorStale } from './stages/sheets.ts';
import { estimateStage, runStage } from './pipeline.ts';
import { formatDoctor, runDoctor } from './doctor.ts';

const USAGE = `heartcut <command>
  new <slug> --title "<t>" [--brief-file f | --brief "<text>" | --example <name>] [--aspect 16:9]
  doctor    check Node, ffmpeg, the language model, pictures and video, folders and .env
  ref <slug> <file> --role selfie|character|location|mood|music [--note ..] [--for <id>]
  run <slug> <stage> [--dry-run] [--ids a,b] [--tier draft|final] [--resolution 1080p|4k] [--force]
  run <slug> keyframes [--ids a,b] [--force]          one still per shot from the chosen sheets (2 options each)
  run <slug> clips [--mode short|full] [--sequence --ids a,b]   --sequence: ONE take over the ids, hard cuts inside
  estimate <slug> <stage> [same flags]
  show <slug> [--json]      list      choose <slug> <assetId> <index>      choose-keyframe <slug> <kfId> <index>
  unpick <slug> <assetId>      remove <slug> <assetId> <index>
  approve <slug> <clipId> [--no]      demo [--spend]     serve [--port 5099]
  --fake (any command): fake mode, the same as HEARTCUT_FAKE=1
  styles      style <slug> <styleId>
  local [--smoke] [--model z_image_turbo|qwen_image]   local GPU status; --smoke renders one image (free)
  library [--kind character|location] [--q text]     adopt <slug> <entryId>     import <slug> <assetId> <file>
  demo: HEARTCUT_FAKE=1 runs all 8 stages offline with placeholders; without it the LLM stages run for real
        and generation stages only show prices unless --spend is given (real money).`;

interface Args { pos: string[]; flags: Record<string, string | true> }

const BOOL_FLAGS = new Set(['dry-run', 'force', 'json', 'no', 'real', 'smoke', 'sequence', 'fake']);

function parseArgs(argv: string[]): Args {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k)) flags[k] = true;
      else if (i + 1 < argv.length) flags[k] = argv[++i];
      else throw new Error(`--${k} needs a value`);
    } else pos.push(a);
  }
  return { pos, flags };
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`missing ${what}\n\n${USAGE}`);
  return v;
}

function asStage(s: string | undefined): Stage {
  const st = need(s, 'stage') as Stage;
  if (!STAGES.includes(st)) throw new Error(`unknown stage "${st}" (one of ${STAGES.join(', ')})`);
  return st;
}

function runOptions(f: Args['flags']): RunOptions {
  const o: RunOptions = {};
  if (f['dry-run']) o.dryRun = true;
  if (f.force) o.force = true;
  if (typeof f.ids === 'string') o.ids = f.ids.split(',').map((s) => s.trim()).filter(Boolean);
  if (f.tier === 'draft' || f.tier === 'final') o.tier = f.tier;
  if (f.resolution === '1080p' || f.resolution === '4k') o.resolution = f.resolution;
  if (typeof f.model === 'string') o.model = f.model;
  if (f.mode !== undefined) {
    if (f.mode !== 'short' && f.mode !== 'full') throw new Error('--mode must be short or full');
    o.promptMode = f.mode;
  }
  if (f.sequence) o.sequence = true;
  return o;
}

const emitFor = (stage: Stage) => (line: string) => console.log(`[${stage}] ${line}`);

function show(p: Project): string {
  const L: string[] = [`${p.title}  (${p.slug}, ${p.aspect})`, ''];
  const state = (s: Stage): string => {
    const done: Record<Stage, boolean> = { brief: p.brief.text.length >= 40, script: !!p.script, sheets: !!p.sheets, images: p.assets.length > 0, scenes: !!p.scenePrompts, keyframes: (p.keyframes?.length ?? 0) > 0, clips: p.clips.length > 0, export: p.exports.length > 0 };
    const last = [...p.jobs].reverse().find((j) => j.stage === s);
    return `${done[s] ? 'done   ' : 'pending'}${last && last.status !== 'done' ? `  (last job ${last.status}${last.error ? `: ${last.error}` : ''})` : ''}${p.approvals[s] ? '  approved' : ''}`;
  };
  L.push(`Look: ${styleFor(p).name}`, '');
  const stale = staleness(p);
  L.push(`  ${'stage'.padEnd(9)} ${'state'.padEnd(7)} stale`);
  for (const s of STAGES) L.push(`  ${s.padEnd(9)} ${state(s)}${stale[s]?.stale ? `  stale (because ${stale[s]!.because} changed)` : ''}`);
  if (p.script) {
    L.push('', 'Characters');
    for (const c of p.script.characters) L.push(`  ${c.name} (${c.id}, ${c.species}): ${c.states.map((s) => s.id).join(' / ')}${c.identityRefId ? '  [identity-locked]' : ''}`);
    L.push('Locations: ' + p.script.locations.map((l) => l.name).join(', '));
    L.push(`Scenes: ${p.script.scenes.length}, ${p.script.scenes.reduce((s, b) => s + b.durationSec, 0)}s total`);
  }
  if (p.assets.length) {
    L.push('', 'Assets');
    const gone = new Set(anchorStale(p));
    for (const a of p.assets) {
      const dep = p.sheets?.items.find((s) => s.id === a.id)?.dependsOn ?? (p.script ? anchorFor(p.script, a.id) : undefined);
      const rel = a.kind === 'location' ? '' : dep ? `  from ${dep}${gone.has(a.id) ? ' (face changed)' : ''}` : '  anchor';
      L.push(`  ${a.id.padEnd(26)} ${a.chosen === undefined ? 'unchosen' : `chose #${a.chosen}`} of ${a.options.length}${rel}`);
    }
  }
  if (p.keyframes?.length) {
    L.push('', 'Keyframes');
    for (const k of p.keyframes) L.push(`  ${k.id.padEnd(26)} ${k.chosen === undefined ? 'unchosen' : `chose #${k.chosen}`} of ${k.options.length}`);
  }
  if (p.clips.length) {
    const ok = p.clips.filter((c) => c.approved).length;
    const kf = p.clips.filter((c) => c.source === 'keyframe').length;
    const seq = p.clips.filter((c) => c.source === 'sequence').length;
    L.push('', `Clips: ${p.clips.length} (${ok} approved${kf ? `, ${kf} from keyframes` : ''}${seq ? `, ${seq} one-take` : ''})`);
  }
  L.push('', process.env.HEARTCUT_FAKE === '1'
    ? `Spend: $${projectSpend(p).toFixed(3)} at list prices (fake mode: nothing was sent or charged)`
    : `Spend: $${projectSpend(p).toFixed(3)}`);
  return L.join('\n');
}

async function demo(spend: boolean): Promise<void> {
  const fx = await import('./demo/demo.ts');
  const slug = 'demo';
  try { loadProject(slug); } catch { createProject({ title: 'Demo: the last apple', slug, briefText: fx.DEMO_BRIEF, aspect: '16:9' }); console.log('created project demo'); }
  // Fake mode writes placeholders, so it can run every stage for real. Outside fake mode the
  // generation stages only price themselves unless --spend is passed; the LLM stages always run.
  const opts: RunOptions = { dryRun: !process.env.HEARTCUT_FAKE && !spend };
  for (const stage of STAGES) {
    try {
      await runStage(slug, stage, opts, emitFor(stage));
      // Images runs twice: anchors first, then (after the pick) every picture built from that face.
      if (stage === 'images') {
        for (const a of loadProject(slug).assets) if (a.chosen === undefined && a.options.length) chooseAsset(slug, a.id, 0);
        await runStage(slug, stage, opts, emitFor(stage));
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (/not available yet/.test(msg)) { console.log(`[${stage}] ${msg} — demo stops here`); return; }
      throw e;
    }
    // Stand-in for the human: pick option 0 everywhere, approve whatever was produced.
    if (stage === 'images') for (const a of loadProject(slug).assets) if (a.chosen === undefined && a.options.length) chooseAsset(slug, a.id, 0);
    if (stage === 'keyframes') for (const k of loadProject(slug).keyframes ?? []) if (k.chosen === undefined && k.options.length) chooseKeyframe(slug, k.id, 0);
    if (stage === 'clips') for (const c of loadProject(slug).clips) if (!c.approved) approveClip(slug, c.id, true);
  }
  console.log('\n' + show(loadProject(slug)));
}

const EXAMPLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

/** The text of examples/<name>.md (or .txt). Lists what exists when the name is wrong. */
function readExample(name: string): string {
  const safe = path.basename(name).replace(/\.(md|txt)$/, '');
  for (const ext of ['.md', '.txt']) {
    const f = path.join(EXAMPLES_DIR, safe + ext);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }
  let have: string[] = [];
  try { have = fs.readdirSync(EXAMPLES_DIR).filter((f) => /\.(md|txt)$/.test(f) && !/^readme/i.test(f)).map((f) => f.replace(/\.(md|txt)$/, '')); } catch { /* no examples folder */ }
  throw new Error(`no example "${safe}". ${have.length ? `Try one of: ${have.join(', ')}` : 'The examples folder is empty.'}`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  // --fake is HEARTCUT_FAKE=1 without shell syntax, so the same command works on macOS, Linux and Windows.
  if (flags.fake) process.env.HEARTCUT_FAKE = '1';
  switch (cmd) {
    case 'new': {
      const slug = need(pos[0], 'slug');
      const briefText = typeof flags.example === 'string' ? readExample(flags.example)
        : typeof flags['brief-file'] === 'string' ? fs.readFileSync(flags['brief-file'], 'utf8') : typeof flags.brief === 'string' ? flags.brief : '';
      const heading = /^#\s+(.+)$/m.exec(briefText)?.[1]?.trim(); // an example's "# Kite Day" is a fine default title
      const p = createProject({ slug, title: typeof flags.title === 'string' ? flags.title : heading || slug, briefText, aspect: (flags.aspect as Aspect) ?? '16:9' });
      console.log(`created ${p.slug}`);
      return;
    }
    case 'ref': {
      const slug = need(pos[0], 'slug');
      const file = need(pos[1], 'file');
      const role = need(flags.role as string, '--role') as RefRole;
      const forId = typeof flags.for === 'string' ? flags.for : undefined;
      const p = loadProject(slug);
      const r = addRef(slug, {
        role, filename: path.basename(file), bytes: fs.readFileSync(file),
        note: typeof flags.note === 'string' ? flags.note : undefined,
        forCharacterId: forId && p.script?.locations.some((l) => l.id === forId) ? undefined : forId,
        forLocationId: forId && p.script?.locations.some((l) => l.id === forId) ? forId : undefined,
      });
      console.log(`added ref ${r.id} (${role})`);
      return;
    }
    case 'run': {
      const stage = asStage(pos[1]);
      await runStage(need(pos[0], 'slug'), stage, runOptions(flags), emitFor(stage));
      return;
    }
    case 'estimate': {
      const e = await estimateStage(need(pos[0], 'slug'), asStage(pos[1]), runOptions(flags));
      for (const i of e.items) console.log(`  ${i.id.padEnd(28)} ${i.model.padEnd(36)} $${i.usd.toFixed(3)}${i.note ? `  ${i.note}` : ''}`);
      console.log(`total $${e.usd.toFixed(3)}`);
      return;
    }
    case 'show': {
      const p = loadProject(need(pos[0], 'slug'));
      console.log(flags.json ? JSON.stringify(p, null, 2) : show(p));
      return;
    }
    case 'list':
      for (const p of listProjects()) console.log(`${p.slug.padEnd(24)} ${p.title}  (${p.updatedAt})`);
      return;
    case 'choose':
      chooseAsset(need(pos[0], 'slug'), need(pos[1], 'assetId'), Number(need(pos[2], 'index')));
      console.log('chosen');
      return;
    case 'choose-keyframe':
      chooseKeyframe(need(pos[0], 'slug'), need(pos[1], 'keyframeId'), Number(need(pos[2], 'index')));
      console.log('chosen');
      return;
    case 'unpick':
      chooseAsset(need(pos[0], 'slug'), need(pos[1], 'assetId'), null);
      console.log('unpicked');
      return;
    case 'remove': {
      const p = removeOption(need(pos[0], 'slug'), need(pos[1], 'assetId'), Number(need(pos[2], 'index')));
      console.log(`removed picture ${pos[2]} from ${pos[1]} (${p.assets.find((a) => a.id === pos[1])?.options.length ?? 0} left)`);
      return;
    }
    case 'approve':
      approveClip(need(pos[0], 'slug'), need(pos[1], 'clipId'), !flags.no);
      console.log(flags.no ? 'unapproved' : 'approved');
      return;
    case 'styles': {
      const label = (slug: string): string => IMAGE_MODELS[slug]?.label ?? slug;
      for (const s of listStyles()) {
        const faces = IMAGE_MODELS[s.models.faces]?.usd;
        console.log(`${s.id.padEnd(24)} ${s.name.padEnd(24)} ${s.family.padEnd(13)} faces ${label(s.models.faces).padEnd(14)} places ${label(s.models.places).padEnd(14)} ~$${(faces ?? 0).toFixed(3)} per 4${s.builtin ? '' : '  (mine)'}`);
      }
      return;
    }
    case 'style': {
      const slug = need(pos[0], 'slug');
      const id = need(pos[1], 'styleId');
      const style = getStyle(id);
      if (!style) throw new Error(`no style "${id}" (run: heartcut styles)`);
      setProjectStyle(slug, style);
      console.log(`${slug} now uses ${style.name}; everything after the brief is stale`);
      return;
    }
    case 'library': {
      const kind = flags.kind === 'character' || flags.kind === 'location' ? flags.kind : undefined;
      if (flags.kind && !kind) throw new Error('--kind must be character or location');
      const rows = listLibrary({ kind, q: typeof flags.q === 'string' ? flags.q : undefined });
      console.log(`${'id'.padEnd(30)} ${'kind'.padEnd(10)} ${'name'.padEnd(24)} ${'project'.padEnd(24)} sheets`);
      for (const e of rows) console.log(`${e.id.padEnd(30)} ${e.kind.padEnd(10)} ${e.name.slice(0, 24).padEnd(24)} ${e.projectTitle.slice(0, 24).padEnd(24)} ${e.sheets.length}`);
      console.log(`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`);
      return;
    }
    case 'adopt': {
      const r = adoptEntry(need(pos[0], 'slug'), need(pos[1], 'entryId'));
      console.log(`adopted ${r.kind} ${r.id} into ${r.project.slug} (${r.project.assets.length} assets)`);
      return;
    }
    case 'import': {
      const file = need(pos[2], 'file');
      importOption(need(pos[0], 'slug'), need(pos[1], 'assetId'), { filename: path.basename(file), bytes: fs.readFileSync(file) });
      console.log(`imported ${path.basename(file)} into ${pos[1]} and chose it`);
      return;
    }
    case 'local': {
      const a = isLocalAvailable();
      console.log(`local GPU: ${a.ok ? 'available' : `NOT available - ${a.reason}`}`);
      console.log(`models with weights: ${a.models.join(', ') || '(none)'}`);
      console.log(`preferLocal setting: ${getSettings().preferLocal ? 'on' : 'off'}`);
      if (!flags.smoke) return;
      const want = typeof flags.model === 'string' ? flags.model : 'z_image_turbo';
      const slug = want === 'qwen_image' ? LOCAL_QWEN : want === 'z_image_turbo' ? LOCAL_Z : undefined;
      if (!slug) throw new Error('--model must be z_image_turbo or qwen_image');
      const q = slug === LOCAL_QWEN;
      const { width, height } = q ? localSize('3:4') : { width: 512, height: 512 };
      const outFile = path.join(MEDIA_ROOT, '_smoke', `smoke-${want}-${width}x${height}.png`);
      const r = await localRun(slug, [{ id: 'smoke', prompt: 'a hand-painted anime portrait of a girl with short silver hair, soft window light, watercolor background', seed: seedFor('smoke', 1), outFile }], { width, height, emit: (l) => console.log(l) });
      console.log(`${LOCAL_MODELS[slug].short} ${width}x${height}: ${r.secs}s -> ${r.files[0]}`);
      return;
    }
    case 'doctor': {
      await (await import('./llm.ts')).readyLlm().catch(() => {});
      const r = runDoctor();
      console.log(flags.json ? JSON.stringify(r, null, 2) : formatDoctor(r));
      if (!r.canRun) process.exitCode = 1;
      return;
    }
    case 'demo':
      return demo(!!flags.spend);
    case 'serve':
      try {
        await (await import('./server.ts')).serve();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') { console.log('server not available yet (src/server.ts is builder C)'); return; }
        throw e;
      }
      return;
    default:
      console.log(USAGE);
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exit(1); });
