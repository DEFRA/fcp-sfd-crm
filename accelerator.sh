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

TEMP_DIR=$(mktemp -d)

echo "Cloning template repo without history..."
git clone --depth=1 "$TEMPLATE_REPO" "$TEMP_DIR"
cd "$TEMP_DIR"

echo "Removing Git history..."
rm -rf .git

echo "Initialising new Git repo..."
git init
git remote add origin "$TARGET_REPO"
git checkout -b "$TARGET_BRANCH"

echo "Adding and committing files..."
git add .
git commit -m "Initial commit from fcp-sfd-accelerator into '$TARGET_BRANCH' on $TARGET_REPO"

echo "Pushing to '$TARGET_BRANCH' on target repo..."
git push -u origin "$TARGET_BRANCH"

echo "fcp-sfd-accelerator has been pushed to branch '$TARGET_BRANCH' on $TARGET_REPO"

cd ..
rm -rf "$TEMP_DIR"
