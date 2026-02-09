# Ubuntu インストールガイド

Ubuntu 24.04 LTS でのデプロイ環境構築手順を提供します。
> **注意**: これらの手順は開発者実施時の覚書となります。ご自身の環境に合わせて調整してください。

---

## Node.js 24.11.11

```bash
# nvmをダウンロードしてインストールする：
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# シェルを再起動する代わりに実行する
\. "$HOME/.nvm/nvm.sh"

# Node.jsをダウンロードしてインストールする：
nvm install 24

# Node.jsのバージョンを確認する：
node -v # "v24.11.1"が表示される。

# npmのバージョンを確認する：
npm -v # "11.6.2"が表示される。
```

---

## Python 3.11

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update

sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip

# apt_getが利用不可となるため注意
# sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
sudo update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1
```

---

## Docker

### インストール

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

# Dockerパッケージのインストール
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Auto Start
sudo systemctl status docker

# テスト
sudo docker run hello-world
```

### ユーザー権限設定

```bash
sudo usermod -aG docker $USER
newgrp docker

groups
# 出力に "docker" が含まれていればOK

docker ps
```

---

## AWS CLI

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

which aws
# /usr/local/bin/aws
```

---

## AWS CDK

```bash
npm install -g aws-cdk

# インストール
cd /home/ubuntu/CEDIX/infrastructure/cdk
npm install
```

