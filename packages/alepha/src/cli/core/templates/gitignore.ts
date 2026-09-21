export const gitignore = () =>
  `
# Dependencies
node_modules/

# Build outputs
dist/
.vite/
# alepha pack writes <project>-<tag>.tar.zst here. The gz pattern stays
# listed too: an artifact packed before the move is still an artifact
# nobody wants committed.
*.tar.zst
*.tar.gz

# Environment files
.env
.env.*
!.env.example

# IDE
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Test coverage
coverage/

# Yarn
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/sdks
!.yarn/versions
.pnp.*
`.trim() + "\n";
