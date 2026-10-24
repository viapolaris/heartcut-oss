# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["mflux==0.22.0"]
# ///
"""
Heartcut local picture worker. Draws pictures on an Apple Silicon Mac with MLX, for free.

Setup (once):
  1. An Apple Silicon Mac (M1 or newer) with about 40 GB free disk and 32 GB+ memory for Qwen-Image.
  2. Install uv:  brew install uv   (or: curl -LsSf https://astral.sh/uv/install.sh | sh)
     uv reads the dependency block at the top of this file and builds its own environment.
     Without uv: python3.12 -m venv .venv && .venv/bin/pip install -r tools/requirements-local.txt,
     then set HEARTCUT_LOCAL_PYTHON=.venv/bin/python.
  3. Download the weights into the Hugging Face cache (ungated, Apache-2.0):
       uvx --from huggingface_hub hf download Qwen/Qwen-Image
       uvx --from huggingface_hub hf download Tongyi-MAI/Z-Image-Turbo
     Optional, for photo edits on this Mac:
       uvx --from huggingface_hub hf download Qwen/Qwen-Image-Edit-2511
       uvx --from huggingface_hub hf download lightx2v/Qwen-Image-Edit-2511-Lightning
  4. Restart Heartcut. Settings then shows "Render on this Mac" as available.

Heartcut runs it as:  echo '<job json>' | uv run tools/local-image.py
(HEARTCUT_LOCAL_WORKER points Heartcut at a different copy.)

Reads one JSON job on stdin, writes one JSON result on stdout:

  in   {"model","steps","width","height","items":[{"id","prompt","seed","outFile","images"?}], "model_name"?, "quantize"?, "lora_paths"?, "lora_scales"?, "guidance"?}
  out  {"ok":true,"images":[{"id","secs","bytes"}]}   or   {"ok":false,"stage","error"}

Progress goes to stderr as "progress <n>/<total>".

Generation is pixel-deterministic for a fixed seed, so Heartcut derives the seed from the sheet id and a rerun
reproduces the same picture. Model load is about 10 s warm, so one job carries every picture of a sheet rather
than one process per picture.

Only permissively licensed, commercially usable models are listed below. FLUX.1-dev and its derivatives are
non-commercial and deliberately absent. Z-Image-Turbo is used instead of FLUX.1-schnell because schnell's
Hugging Face repo is gated (needs an account and a licence click); Z-Image is not.
"""
import importlib
import json
import os
import sys
import time

# mflux model-config name -> the pipeline class that knows how to run it.
# These classes take the same (model_config, quantize) constructor and the same
# generate_image(seed, prompt, num_inference_steps, width, height), which is why the rest of this worker is
# model-agnostic.
VARIANTS = {
    "z_image": ("mflux.models.z_image.variants.z_image", "ZImage"),
    "z_image_turbo": ("mflux.models.z_image.variants.z_image", "ZImage"),
    "qwen_image": ("mflux.models.qwen.variants.txt2img.qwen_image", "QwenImage"),
    # Photo edit: items carry "images" (input photo paths). Qwen-Image-Edit-2511 is Apache-2.0.
    "qwen_image_edit_2511": ("mflux.models.qwen.variants.edit.qwen_image_edit", "QwenImageEdit"),
}
EDIT_VARIANTS = {"qwen_image_edit_2511"}


def fail(stage: str, err: object) -> None:
    print(json.dumps({"ok": False, "stage": stage, "error": repr(err)}))
    sys.exit(1)


def main() -> None:
    try:
        job = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        fail("parse", e)

    items = job.get("items", [])
    if not items:
        print(json.dumps({"ok": True, "images": []}))
        return

    try:
        from mflux.models.common.config.model_config import ModelConfig
    except Exception as e:  # noqa: BLE001
        fail("import", e)

    name = job.get("model") or "z_image_turbo"
    try:
        factory = getattr(ModelConfig, name)
    except AttributeError as e:
        fail("model_config", f"unknown mflux model config {name!r}: {e!r}")

    # The model config alone is not enough: mflux implements each family as its own pipeline class, and
    # constructing the wrong one around a valid config loads and runs without complaining. Map the config name
    # to its class, and refuse anything unmapped rather than guess. Imported lazily: each pulls in a large tree.
    try:
        variant = VARIANTS[name]
    except KeyError:
        fail(
            "variant",
            f"{name!r} has no mapped pipeline class; add it to VARIANTS "
            f"(known: {', '.join(sorted(VARIANTS))})",
        )

    try:
        module, cls_name = variant
        cls = getattr(importlib.import_module(module), cls_name)
    except Exception as e:  # noqa: BLE001
        fail("import_variant", e)

    # Optional "model_name" pins the Hugging Face repo, overriding the one mflux bakes into the config
    # (its `qwen_image` is Qwen/Qwen-Image-2512; Heartcut sends Qwen/Qwen-Image). Same architecture, same class.
    try:
        config = factory()
        if job.get("model_name"):
            config.model_name = str(job["model_name"])
        extra = {}
        # Optional speed-up adapters (e.g. Qwen-Image-Edit Lightning: 8 steps instead of 20+, guidance 1.0).
        if job.get("lora_paths"):
            extra["lora_paths"] = [str(x) for x in job["lora_paths"]]
            extra["lora_scales"] = [float(x) for x in job.get("lora_scales") or [1.0] * len(extra["lora_paths"])]
        model = cls(model_config=config, quantize=int(job.get("quantize", 8)), **extra)
    except Exception as e:  # noqa: BLE001
        fail("load", e)

    steps = int(job.get("steps", 8))
    width = int(job.get("width", 1536))
    height = int(job.get("height", 864))

    images = []
    for item in items:
        t = time.time()
        out = item["outFile"]
        try:
            kwargs = dict(seed=int(item["seed"]), prompt=item["prompt"], num_inference_steps=steps, width=width, height=height)
            if job.get("guidance") is not None:
                kwargs["guidance"] = float(job["guidance"])
            if name in EDIT_VARIANTS:
                paths = [str(x) for x in item.get("images") or []]
                if not paths:
                    fail(f"generate:{item['id']}", "edit model needs item.images (input photo paths)")
                kwargs["image_paths"] = paths
            img = model.generate_image(**kwargs)
            # overwrite=True is required: mflux otherwise renames around an existing file (a.png -> a_1.png),
            # so a rerun would silently leave the old picture in place.
            img.save(path=out, export_json_metadata=False, overwrite=True)
        except Exception as e:  # noqa: BLE001
            fail(f"generate:{item['id']}", e)

        # Verify the bytes landed where we asked.
        try:
            written = os.path.getsize(out)
        except OSError as e:
            fail(f"missing:{item['id']}", f"expected {out}: {e!r}")
        if written == 0:
            fail(f"empty:{item['id']}", f"{out} is zero bytes")

        images.append({"id": item["id"], "secs": round(time.time() - t, 1), "bytes": written})
        # Progress on stderr so it does not pollute the stdout payload.
        print(f"progress {len(images)}/{len(items)}", file=sys.stderr, flush=True)

    print(json.dumps({"ok": True, "images": images}))


if __name__ == "__main__":
    main()
