export const gitignore = () =>
  `
# Dependencies
node_modules/

# Build outputs
dist/
.vite/
# alepha pack writes <project>-<tag>.tar.gz here
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
