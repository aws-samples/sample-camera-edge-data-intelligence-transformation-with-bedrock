#!/bin/bash

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$source_dir"

docker compose down
