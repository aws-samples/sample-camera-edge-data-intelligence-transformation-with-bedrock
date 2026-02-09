# CDK bundling用のシンプルなDockerfile (Vite)
# checkov:skip=CKV_DOCKER_2:Build-only container - exits after build, no long-running process
FROM node:22-alpine
WORKDIR /app

# キャッシュ無効化用（CDKから渡される）
ARG CACHEBUST=1

# ビルド引数として環境変数を受け取る (Vite用)
ARG VITE_API_URL
ARG VITE_USER_POOL_ID
ARG VITE_USER_POOL_CLIENT_ID
ARG VITE_IDENTITY_POOL_ID
ARG VITE_REGION
ARG VITE_DEPLOY_MODE

# 環境変数として設定 (Vite用)
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_USER_POOL_ID=$VITE_USER_POOL_ID
ENV VITE_USER_POOL_CLIENT_ID=$VITE_USER_POOL_CLIENT_ID
ENV VITE_IDENTITY_POOL_ID=$VITE_IDENTITY_POOL_ID
ENV VITE_REGION=$VITE_REGION
ENV VITE_DEPLOY_MODE=$VITE_DEPLOY_MODE

# 依存関係のインストール（devDependencies も含める）
COPY package.json ./
# rollup のプラットフォーム依存を解決するため、package-lock.json を使わずに npm install を使用
# NODE_ENV=production だと devDependencies がスキップされるため、ここでは設定しない
RUN npm install --legacy-peer-deps

# ソースコードをコピー
COPY . .

# ビルド実行
RUN npm run build

# セキュリティ対策: node ユーザーに所有権変更
RUN chown -R node:node /app

USER node

# デフォルトコマンド（デバッグ用）
CMD ["ls", "-la", "/app/build"]
