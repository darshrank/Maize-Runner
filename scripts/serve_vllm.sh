#!/usr/bin/env bash
set -euo pipefail
# Run on the Brev Linux H100/A100 80GB host. Never check tokens into this file.
# Source: NVIDIA's BF16 model card (verified 2026-10-17).
MODEL="nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16"
IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:v0.27.1-cu129}"
mode=(--rm)
if [[ "${VLLM_DETACH:-0}" == "1" ]]; then
  mode=(--detach)
fi
exec docker run "${mode[@]}" --name fieldtwin-vllm --gpus all --ipc=host \
  -p 127.0.0.1:8000:8000 \
  -v "${HF_HOME:-$HOME/.cache/huggingface}:/root/.cache/huggingface" \
  -v "${VLLM_CACHE_DIR:-$HOME/.cache/vllm}:/root/.cache/vllm" \
  --env "VLLM_ENABLE_CUDA_COMPATIBILITY=${VLLM_ENABLE_CUDA_COMPATIBILITY:-1}" \
  "$IMAGE" \
  --model "$MODEL" \
  --dtype bfloat16 \
  --max-model-len 16384 \
  --max-num-seqs 64 \
  --enable-prefix-caching \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --reasoning-parser nemotron_v3 \
  --async-scheduling \
  --mamba-backend flashinfer \
  --mamba-ssm-cache-dtype float16 \
  --enable-mamba-cache-stochastic-rounding \
  --mamba-cache-philox-rounds 5
