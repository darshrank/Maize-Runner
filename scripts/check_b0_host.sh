#!/usr/bin/env bash
# Read-only preflight for the intended Brev GPU host; does not install or launch anything.
set -euo pipefail
for dependency in nvidia-smi docker curl; do
  command -v "$dependency" >/dev/null || { echo "Missing required command: $dependency" >&2; exit 1; }
done
echo "GPU inventory (name, memory MiB):"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits
if ! nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | awk '$1 >= 78000 {found=1} END {exit !found}'; then
  echo "B0 BF16 deployment requires an approximately 80 GB GPU; no qualifying GPU found." >&2
  exit 1
fi
echo "Docker server version:"
docker version --format '{{.Server.Version}}'
echo "Disk available for model and image cache:"
df -h "${HF_HOME:-$HOME}"
echo "GPU processes (check capacity before starting vLLM):"
nvidia-smi
echo "Port 8000 listeners:"
if command -v ss >/dev/null; then
  ss -ltn '( sport = :8000 )'
fi
echo "Preflight passed. Review disk, GPU occupancy and any existing port listener before launch."
