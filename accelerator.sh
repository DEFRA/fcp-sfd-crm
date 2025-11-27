#!/bin/bash

set -e

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <template-repo-url> <target-repo-url> [target-branch]"
  echo "Example: $0 https://github.com/DEFRA/fcp-sfd-accelerator.git https://github.com/DEFRA/fcp-sfd-example.git template-setup"
  exit 1
fi

TEMPLATE_REPO="$1"
TARGET_REPO="$2"
TARGET_BRANCH="${3:-template-setup}"

TEMP_TARGET_DIR=$(mktemp -d)
TEMP_TEMPLATE_DIR=$(mktemp -d)

echo "Cloning target repo..."
git clone "$TARGET_REPO" "$TEMP_TARGET_DIR"
cd "$TEMP_TARGET_DIR"

echo "Creating new branch '$TARGET_BRANCH'..."
git checkout -b "$TARGET_BRANCH"

echo "Deleting all files except .git..."
shopt -s extglob
rm -rf !(.git)
shopt -u extglob

echo "Cloning template repo (accelerator) without history..."
git clone --depth=1 "$TEMPLATE_REPO" "$TEMP_TEMPLATE_DIR"

echo "Copying files from template repo to target branch..."
rsync -av --exclude='.git' "$TEMP_TEMPLATE_DIR"/ ./

echo "Adding and committing files..."
git add .
git commit -m "Apply fcp-sfd-accelerator template to '$TARGET_BRANCH'"

echo "Pushing branch '$TARGET_BRANCH' to target repo..."
git push -u origin "$TARGET_BRANCH"

echo "Accelerator template has been applied to branch '$TARGET_BRANCH' on $TARGET_REPO"

cd ..
rm -rf "$TEMP_TARGET_DIR" "$TEMP_TEMPLATE_DIR"
