#!/usr/bin/env bash
# Install gym-DSSAT (gym-dssat-pdi) from the official apt packages.
# Supported: Ubuntu 22.04 (jammy), Ubuntu 20.04 (focal), Debian 12 (bookworm).
# Source: https://rgautron.gitlabpages.inria.fr/gym-dssat-docs/Installation/packages.html
# Needs sudo. Installs a self-contained venv at /opt/gym_dssat_pdi.
set -euo pipefail

CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
case "$CODENAME" in
  jammy|focal|bookworm) ;;
  *) echo "gym-DSSAT packages support jammy, focal, bookworm; this is '$CODENAME'"; exit 1 ;;
esac
DISTRO="$(. /etc/os-release && echo "${ID}")"   # ubuntu or debian (PDI repo path)

# 1. PDI repository (gym-DSSAT depends on the PDI data interface library).
echo "deb [ arch=amd64 ] https://repo.pdi.dev/${DISTRO} ${CODENAME} main" \
  | sudo tee /etc/apt/sources.list.d/pdi.list > /dev/null
sudo wget -O /etc/apt/trusted.gpg.d/pdidev-archive-keyring.gpg \
  "https://repo.pdi.dev/${DISTRO}/pdidev-archive-keyring.gpg"
sudo chmod a+r /etc/apt/trusted.gpg.d/pdidev-archive-keyring.gpg /etc/apt/sources.list.d/pdi.list
sudo apt update
sudo apt install -y pdidev-archive-keyring

# 2. gym-DSSAT repository.
sudo mkdir -p /usr/local/share/keyrings
sudo wget -O- https://xlab.udc.gal/gym-dssat/gym-dssat-archive-keyring.gpg \
  | sudo tee /usr/local/share/keyrings/gym-dssat-archive-keyring.gpg > /dev/null
echo "deb [signed-by=/usr/local/share/keyrings/gym-dssat-archive-keyring.gpg] https://xlab.udc.gal/gym-dssat ${CODENAME} main" \
  | sudo tee /etc/apt/sources.list.d/gym-dssat.list > /dev/null
sudo chmod a+r /usr/local/share/keyrings/gym-dssat-archive-keyring.gpg
sudo apt update
sudo apt install -y gym-dssat-pdi

# 3. Smoke test with the bundled sample.
source /opt/gym_dssat_pdi/bin/activate
python /opt/gym_dssat_pdi/samples/run_env.py
deactivate
echo "gym-DSSAT installed: /opt/gym_dssat_pdi"
