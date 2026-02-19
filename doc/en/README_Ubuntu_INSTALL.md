# Ubuntu Installation Guide

Provides deployment environment setup procedures for Ubuntu 24.04 LTS.
> **Note**:
> These procedures are notes from development.
> Please adjust according to your environment.

---
### If login user is not ubuntu, change it
```
su ubuntu

## If password setting is needed
sudo passwd <any-password>
```

## Node.js 24.11.11
```bash
# Download and install nvm:
export NVM_DIR=/home/ubuntu/.nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Run instead of restarting shell
\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:
nvm install 24

# Check Node.js version:
node -v # Should display "v24.11.1"

# Check npm version:
npm -v # Should display "11.6.2"
```

## Python 3.11
```bash
sudo apt update
sudo apt upgrade -y
sudo apt install software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update

sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip

# Note: apt_get will become unavailable
# sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
sudo update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1
```

## Docker
### Installation
```bash
# Add Docker's official GPG key:
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update

# Install Docker packages
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Auto Start
sudo systemctl status docker

# Test
sudo docker run hello-world
```

### User Permission Settings
```bash
sudo usermod -aG docker $USER
newgrp docker

groups
# Output should include "docker"
# If not, log out and log back in, then try again.

docker ps
```

## AWS CLI
```bash
sudo apt update && sudo apt install -y unzip

curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

which aws
# /usr/local/bin/aws
```

## AWS CDK
```bash
npm install -g aws-cdk
```

## Git Clone
```
git clone https://github.com/aws-samples/sample-camera-edge-data-intelligence-transformation-with-bedrock/tree/dev?tab=readme-ov-file
```
