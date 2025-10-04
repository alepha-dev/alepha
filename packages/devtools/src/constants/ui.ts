// language=HTML
export const ui = `<!DOCTYPE html>
<html lang="en">
<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Alepha DevTools</title>
		<style>
			:root {
				--primary: #3b82f6;
				--primary-dark: #2563eb;
				--success: #10b981;
				--warning: #f59e0b;
				--danger: #ef4444;
				--bg-primary: #0f172a;
				--bg-secondary: #1e293b;
				--bg-tertiary: #334155;
				--text-primary: #f8fafc;
				--text-secondary: #cbd5e1;
				--text-muted: #94a3b8;
				--border: #334155;
				--code-bg: #1e293b;
				--shadow: rgba(0, 0, 0, 0.3);
			}

			* {
				box-sizing: border-box;
				margin: 0;
				padding: 0;
			}

			body {
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
				background: linear-gradient(135deg, var(--bg-primary) 0%, #0c1222 100%);
				color: var(--text-primary);
				min-height: 100vh;
			}

			/* Header */
			.header {
				background: var(--bg-secondary);
				border-bottom: 1px solid var(--border);
				padding: 1.5rem 2rem;
				position: sticky;
				top: 0;
				z-index: 1000;
				box-shadow: 0 4px 6px var(--shadow);
			}

			.header-content {
				max-width: 1600px;
				margin: 0 auto;
				display: flex;
				justify-content: space-between;
				align-items: center;
			}

			.logo {
				font-size: 1.5rem;
				font-weight: 700;
				background: linear-gradient(135deg, var(--primary), #8b5cf6);
				-webkit-background-clip: text;
				-webkit-text-fill-color: transparent;
				background-clip: text;
			}

			.header-stats {
				display: flex;
				gap: 2rem;
			}

			.stat {
				text-align: center;
			}

			.stat-value {
				font-size: 1.5rem;
				font-weight: 700;
				color: var(--primary);
			}

			.stat-label {
				font-size: 0.75rem;
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.05em;
			}

			/* Navigation */
			.nav {
				background: var(--bg-secondary);
				border-bottom: 1px solid var(--border);
				position: sticky;
				top: 73px;
				z-index: 999;
			}

			.nav-container {
				max-width: 1600px;
				margin: 0 auto;
				padding: 0 2rem;
				display: flex;
				gap: 0.5rem;
				overflow-x: auto;
			}

			.nav-tab {
				padding: 1rem 1.5rem;
				background: transparent;
				border: none;
				color: var(--text-secondary);
				cursor: pointer;
				font-size: 0.875rem;
				font-weight: 600;
				border-bottom: 2px solid transparent;
				transition: all 0.2s;
				white-space: nowrap;
			}

			.nav-tab:hover {
				color: var(--text-primary);
				background: rgba(255, 255, 255, 0.05);
			}

			.nav-tab.active {
				color: var(--primary);
				border-bottom-color: var(--primary);
			}

			/* Main Container */
			.container {
				max-width: 1600px;
				margin: 0 auto;
				padding: 2rem;
			}

			.tab-content {
				display: none;
			}

			.tab-content.active {
				display: block;
				animation: fadeIn 0.3s;
			}

			@keyframes fadeIn {
				from { opacity: 0; transform: translateY(10px); }
				to { opacity: 1; transform: translateY(0); }
			}

			/* Search and Filters */
			.controls {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: 8px;
				padding: 1.5rem;
				margin-bottom: 1.5rem;
			}

			.search-box {
				display: flex;
				gap: 1rem;
				margin-bottom: 1rem;
			}

			.search-input {
				flex: 1;
				padding: 0.75rem 1rem;
				background: var(--bg-tertiary);
				border: 1px solid var(--border);
				border-radius: 6px;
				color: var(--text-primary);
				font-size: 0.875rem;
			}

			.search-input:focus {
				outline: none;
				border-color: var(--primary);
				box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
			}

			.filter-buttons {
				display: flex;
				gap: 0.5rem;
				flex-wrap: wrap;
			}

			.filter-btn {
				padding: 0.5rem 1rem;
				background: var(--bg-tertiary);
				border: 1px solid var(--border);
				border-radius: 6px;
				color: var(--text-secondary);
				font-size: 0.75rem;
				cursor: pointer;
				transition: all 0.2s;
			}

			.filter-btn:hover {
				background: var(--bg-primary);
				border-color: var(--primary);
			}

			.filter-btn.active {
				background: var(--primary);
				color: white;
				border-color: var(--primary);
			}

			/* Cards */
			.card-grid {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
				gap: 1.5rem;
				margin-bottom: 2rem;
			}

			.card {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: 8px;
				padding: 1.5rem;
				transition: all 0.2s;
				cursor: pointer;
			}

			.card:hover {
				border-color: var(--primary);
				box-shadow: 0 4px 12px var(--shadow);
				transform: translateY(-2px);
			}

			.card-header {
				display: flex;
				justify-content: space-between;
				align-items: start;
				margin-bottom: 1rem;
			}

			.card-title {
				font-size: 1.125rem;
				font-weight: 600;
				color: var(--text-primary);
				word-break: break-word;
			}

			.badge {
				padding: 0.25rem 0.75rem;
				border-radius: 12px;
				font-size: 0.75rem;
				font-weight: 600;
				text-transform: uppercase;
				white-space: nowrap;
			}

			.badge-get { background: #10b981; color: white; }
			.badge-post { background: #3b82f6; color: white; }
			.badge-put { background: #f59e0b; color: white; }
			.badge-delete { background: #ef4444; color: white; }
			.badge-patch { background: #8b5cf6; color: white; }
			.badge-secure { background: #dc2626; color: white; }
			.badge-internal { background: #3b82f6; color: white; }
			.badge-external { background: #8b5cf6; color: white; }

			.card-description {
				color: var(--text-secondary);
				font-size: 0.875rem;
				margin-bottom: 1rem;
				line-height: 1.5;
			}

			.card-meta {
				display: flex;
				flex-wrap: wrap;
				gap: 1rem;
				font-size: 0.75rem;
				color: var(--text-muted);
			}

			.card-meta-item {
				display: flex;
				align-items: center;
				gap: 0.5rem;
			}

			.card-path {
				background: var(--code-bg);
				padding: 0.5rem;
				border-radius: 4px;
				font-family: 'Courier New', monospace;
				font-size: 0.875rem;
				word-break: break-all;
				margin-top: 0.5rem;
			}

			/* Table */
			.table-container {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: 8px;
				overflow: hidden;
			}

			table {
				width: 100%;
				border-collapse: collapse;
			}

			thead {
				background: var(--bg-tertiary);
			}

			th {
				padding: 1rem;
				text-align: left;
				font-weight: 600;
				font-size: 0.75rem;
				color: var(--text-secondary);
				text-transform: uppercase;
				letter-spacing: 0.05em;
				border-bottom: 1px solid var(--border);
			}

			td {
				padding: 1rem;
				border-bottom: 1px solid var(--border);
				color: var(--text-primary);
			}

			tbody tr {
				transition: background 0.2s;
			}

			tbody tr:hover {
				background: var(--bg-tertiary);
			}

			/* Code Block */
			.code-block {
				background: var(--code-bg);
				border: 1px solid var(--border);
				border-radius: 8px;
				padding: 1rem;
				overflow-x: auto;
				font-family: 'Courier New', monospace;
				font-size: 0.875rem;
				line-height: 1.6;
			}

			/* Logs */
			.log-container {
				background: var(--code-bg);
				border: 1px solid var(--border);
				border-radius: 8px;
				max-height: 600px;
				overflow-y: auto;
			}

			.log-entry {
				padding: 0.75rem 1rem;
				border-bottom: 1px solid var(--border);
				font-family: 'Courier New', monospace;
				font-size: 0.875rem;
				white-space: pre-wrap;
				word-break: break-word;
			}

			.log-entry:last-child {
				border-bottom: none;
			}

			.log-error { background: rgba(239, 68, 68, 0.1); color: #fca5a5; }
			.log-warn { background: rgba(245, 158, 11, 0.1); color: #fcd34d; }
			.log-info { background: rgba(59, 130, 246, 0.1); color: #93c5fd; }
			.log-debug { background: rgba(156, 163, 175, 0.1); color: #d1d5db; }

			/* Empty State */
			.empty-state {
				text-align: center;
				padding: 4rem 2rem;
				color: var(--text-muted);
			}

			.empty-icon {
				font-size: 4rem;
				margin-bottom: 1rem;
				opacity: 0.3;
			}

			/* Detail View */
			.detail-section {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: 8px;
				padding: 1.5rem;
				margin-bottom: 1.5rem;
			}

			.detail-title {
				font-size: 0.875rem;
				font-weight: 600;
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.05em;
				margin-bottom: 1rem;
			}

			.property-list {
				display: grid;
				gap: 0.75rem;
			}

			.property {
				display: grid;
				grid-template-columns: 150px 1fr;
				gap: 1rem;
			}

			.property-key {
				color: var(--text-muted);
				font-size: 0.875rem;
			}

			.property-value {
				color: var(--text-primary);
				font-size: 0.875rem;
				word-break: break-word;
			}

			.property-value code {
				background: var(--code-bg);
				padding: 0.125rem 0.5rem;
				border-radius: 4px;
				font-family: 'Courier New', monospace;
			}

			/* Loading */
			.loading {
				display: flex;
				justify-content: center;
				align-items: center;
				padding: 4rem;
			}

			.spinner {
				width: 40px;
				height: 40px;
				border: 3px solid var(--border);
				border-top-color: var(--primary);
				border-radius: 50%;
				animation: spin 0.8s linear infinite;
			}

			@keyframes spin {
				to { transform: rotate(360deg); }
			}

			/* Utility */
			.hidden {
				display: none !important;
			}

			.text-muted {
				color: var(--text-muted);
			}

			.text-code {
				font-family: 'Courier New', monospace;
				background: var(--code-bg);
				padding: 0.125rem 0.5rem;
				border-radius: 4px;
				font-size: 0.875rem;
			}

			/* Scrollbar */
			::-webkit-scrollbar {
				width: 8px;
				height: 8px;
			}

			::-webkit-scrollbar-track {
				background: var(--bg-primary);
			}

			::-webkit-scrollbar-thumb {
				background: var(--border);
				border-radius: 4px;
			}

			::-webkit-scrollbar-thumb:hover {
				background: var(--text-muted);
			}

			/* Responsive */
			@media (max-width: 768px) {
				.header-stats {
					display: none;
				}

				.card-grid {
					grid-template-columns: 1fr;
				}

				.property {
					grid-template-columns: 1fr;
					gap: 0.25rem;
				}
			}
		</style>
</head>
<body>
		<!-- Header -->
		<div class="header">
			<div class="header-content">
				<div class="logo">⚡ Alepha DevTools</div>
				<div class="header-stats">
					<div class="stat">
						<div class="stat-value" id="stat-actions">0</div>
						<div class="stat-label">Actions</div>
					</div>
					<div class="stat">
						<div class="stat-value" id="stat-pages">0</div>
						<div class="stat-label">Pages</div>
					</div>
					<div class="stat">
						<div class="stat-value" id="stat-modules">0</div>
						<div class="stat-label">Modules</div>
					</div>
					<div class="stat">
						<div class="stat-value" id="stat-providers">0</div>
						<div class="stat-label">Providers</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Navigation -->
		<div class="nav">
			<div class="nav-container">
				<button class="nav-tab active" data-tab="overview">Overview</button>
				<button class="nav-tab" data-tab="actions">Actions</button>
				<button class="nav-tab" data-tab="pages">Pages</button>
				<button class="nav-tab" data-tab="queues">Queues</button>
				<button class="nav-tab" data-tab="schedulers">Schedulers</button>
				<button class="nav-tab" data-tab="topics">Topics</button>
				<button class="nav-tab" data-tab="buckets">Buckets</button>
				<button class="nav-tab" data-tab="caches">Caches</button>
				<button class="nav-tab" data-tab="realms">Realms</button>
				<button class="nav-tab" data-tab="providers">Providers</button>
				<button class="nav-tab" data-tab="modules">Modules</button>
				<button class="nav-tab" data-tab="logs">Logs</button>
			</div>
		</div>

		<!-- Main Container -->
		<div class="container">
			<!-- Overview Tab -->
			<div class="tab-content active" id="tab-overview">
				<div class="detail-section">
					<h2 class="detail-title">System Overview</h2>
					<div id="overview-content" class="loading">
						<div class="spinner"></div>
					</div>
				</div>
			</div>

			<!-- Actions Tab -->
			<div class="tab-content" id="tab-actions">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-actions" placeholder="Search actions by name, path, or group..." />
					</div>
					<div class="filter-buttons" id="filter-actions-methods"></div>
				</div>
				<div id="actions-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Pages Tab -->
			<div class="tab-content" id="tab-pages">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-pages" placeholder="Search pages by name or path..." />
					</div>
				</div>
				<div id="pages-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Queues Tab -->
			<div class="tab-content" id="tab-queues">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-queues" placeholder="Search queues..." />
					</div>
				</div>
				<div id="queues-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Schedulers Tab -->
			<div class="tab-content" id="tab-schedulers">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-schedulers" placeholder="Search schedulers..." />
					</div>
				</div>
				<div id="schedulers-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Topics Tab -->
			<div class="tab-content" id="tab-topics">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-topics" placeholder="Search topics..." />
					</div>
				</div>
				<div id="topics-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Buckets Tab -->
			<div class="tab-content" id="tab-buckets">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-buckets" placeholder="Search buckets..." />
					</div>
				</div>
				<div id="buckets-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Caches Tab -->
			<div class="tab-content" id="tab-caches">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-caches" placeholder="Search caches..." />
					</div>
				</div>
				<div id="caches-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Realms Tab -->
			<div class="tab-content" id="tab-realms">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-realms" placeholder="Search realms..." />
					</div>
				</div>
				<div id="realms-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Providers Tab -->
			<div class="tab-content" id="tab-providers">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-providers" placeholder="Search providers..." />
					</div>
				</div>
				<div id="providers-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Modules Tab -->
			<div class="tab-content" id="tab-modules">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-modules" placeholder="Search modules..." />
					</div>
				</div>
				<div id="modules-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>

			<!-- Logs Tab -->
			<div class="tab-content" id="tab-logs">
				<div class="controls">
					<div class="search-box">
						<input type="text" class="search-input" id="search-logs" placeholder="Search logs..." />
					</div>
					<div class="filter-buttons">
						<button class="filter-btn active" data-level="all">All</button>
						<button class="filter-btn" data-level="error">Errors</button>
						<button class="filter-btn" data-level="warn">Warnings</button>
						<button class="filter-btn" data-level="info">Info</button>
						<button class="filter-btn" data-level="debug">Debug</button>
					</div>
				</div>
				<div id="logs-content" class="loading">
					<div class="spinner"></div>
				</div>
			</div>
		</div>

		<script>
			let metadata = null;
			let activeFilters = {
				actions: { methods: new Set() },
				logs: { level: 'all' }
			};

			// Tab Navigation
			document.querySelectorAll('.nav-tab').forEach(tab => {
				tab.addEventListener('click', () => {
					const tabName = tab.dataset.tab;
					document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
					document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
					tab.classList.add('active');
					document.getElementById(\`tab-\${tabName}\`).classList.add('active');
					renderTab(tabName);
				});
			});

			// Utility Functions
			function escapeHtml(text) {
				const div = document.createElement('div');
				div.textContent = text;
				return div.innerHTML;
			}

			function formatJson(obj) {
				return JSON.stringify(obj, null, 2);
			}

			function getLogLevel(formatted) {
				const lower = formatted.toLowerCase();
				if (lower.includes('error')) return 'error';
				if (lower.includes('warn')) return 'warn';
				if (lower.includes('info')) return 'info';
				return 'debug';
			}

			// Search Functions
			function setupSearch(inputId, renderFn) {
				const input = document.getElementById(inputId);
				if (!input) return;

				let debounceTimer;
				input.addEventListener('input', () => {
					clearTimeout(debounceTimer);
					debounceTimer = setTimeout(renderFn, 300);
				});
			}

			function matchesSearch(item, searchTerm, fields) {
				if (!searchTerm) return true;
				const term = searchTerm.toLowerCase();
				return fields.some(field => {
					const value = field.split('.').reduce((obj, key) => obj?.[key], item);
					return value && String(value).toLowerCase().includes(term);
				});
			}

			// Render Functions
			function renderOverview() {
				if (!metadata) return;

				const content = document.getElementById('overview-content');
				const stats = {
					'Total Actions': metadata.actions?.length || 0,
					'Total Pages': metadata.pages?.length || 0,
					'Total Queues': metadata.queues?.length || 0,
					'Total Schedulers': metadata.schedulers?.length || 0,
					'Total Topics': metadata.topics?.length || 0,
					'Total Buckets': metadata.buckets?.length || 0,
					'Total Caches': metadata.caches?.length || 0,
					'Total Realms': metadata.realms?.length || 0,
					'Total Providers': metadata.providers?.length || 0,
					'Total Modules': metadata.modules?.length || 0,
					'Log Entries': metadata.logs?.length || 0,
				};

				const methodCounts = {};
				metadata.actions?.forEach(action => {
					methodCounts[action.method] = (methodCounts[action.method] || 0) + 1;
				});

				content.innerHTML = \`
					<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
						\${Object.entries(stats).map(([key, value]) => \`
							<div style="background: var(--bg-tertiary); padding: 1.5rem; border-radius: 8px; text-align: center;">
								<div style="font-size: 2rem; font-weight: 700; color: var(--primary);">\${value}</div>
								<div style="font-size: 0.875rem; color: var(--text-muted); margin-top: 0.5rem;">\${escapeHtml(key)}</div>
							</div>
						\`).join('')}
					</div>

					\${Object.keys(methodCounts).length > 0 ? \`
						<div class="detail-section">
							<h3 class="detail-title">HTTP Methods Distribution</h3>
							<div style="display: flex; gap: 1rem; flex-wrap: wrap;">
								\${Object.entries(methodCounts).map(([method, count]) => \`
									<div class="badge badge-\${method.toLowerCase()}">\${method}: \${count}</div>
								\`).join('')}
							</div>
						</div>
					\` : ''}

					<div class="detail-section">
						<h3 class="detail-title">Raw Metadata</h3>
						<div class="code-block">\${escapeHtml(formatJson(metadata))}</div>
					</div>
				\`;
			}

			function renderActions() {
				if (!metadata?.actions) return;

				const searchTerm = document.getElementById('search-actions')?.value || '';
				const filteredActions = metadata.actions.filter(action => {
					const matchesMethod = activeFilters.actions.methods.size === 0 ||
						activeFilters.actions.methods.has(action.method);
					const matchesSearchTerm = matchesSearch(action, searchTerm, ['name', 'path', 'group', 'fullPath']);
					return matchesMethod && matchesSearchTerm;
				});

				const content = document.getElementById('actions-content');

				if (filteredActions.length === 0) {
					content.innerHTML = \`
						<div class="empty-state">
							<div class="empty-icon">🔍</div>
							<div>No actions found</div>
						</div>
					\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredActions.map(action => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(action.name)}</div>
									<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
										<span class="badge badge-\${action.method.toLowerCase()}">\${action.method}</span>
										\${action.secure ? '<span class="badge badge-secure">🔒 Secure</span>' : ''}
									</div>
								</div>
								\${action.description ? \`<div class="card-description">\${escapeHtml(action.description)}</div>\` : ''}
								<div class="card-path">\${escapeHtml(action.fullPath)}</div>
								<div class="card-meta">
									<div class="card-meta-item">
										<span>📁</span>
										<span>\${escapeHtml(action.group)}</span>
									</div>
									\${action.disabled ? '<div class="card-meta-item"><span>⚠️</span><span>Disabled</span></div>' : ''}
									\${action.hide ? '<div class="card-meta-item"><span>👁️</span><span>Hidden</span></div>' : ''}
								</div>
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderPages() {
				if (!metadata?.pages) return;

				const searchTerm = document.getElementById('search-pages')?.value || '';
				const filteredPages = metadata.pages.filter(page =>
					matchesSearch(page, searchTerm, ['name', 'path'])
				);

				const content = document.getElementById('pages-content');

				if (filteredPages.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No pages found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredPages.map(page => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(page.name)}</div>
									\${page.static ? '<span class="badge" style="background: var(--success);">Static</span>' : ''}
								</div>
								\${page.description ? \`<div class="card-description">\${escapeHtml(page.description)}</div>\` : ''}
								\${page.path ? \`<div class="card-path">\${escapeHtml(page.path)}</div>\` : ''}
								<div class="card-meta">
									\${page.hasComponent ? '<div class="card-meta-item"><span>✓</span><span>Component</span></div>' : ''}
									\${page.hasLazy ? '<div class="card-meta-item"><span>⚡</span><span>Lazy</span></div>' : ''}
									\${page.hasResolve ? '<div class="card-meta-item"><span>🔄</span><span>Resolve</span></div>' : ''}
									\${page.hasChildren ? '<div class="card-meta-item"><span>👶</span><span>Children</span></div>' : ''}
									\${page.hasErrorHandler ? '<div class="card-meta-item"><span>⚠️</span><span>Error Handler</span></div>' : ''}
								</div>
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderQueues() {
				if (!metadata?.queues) return;

				const searchTerm = document.getElementById('search-queues')?.value || '';
				const filteredQueues = metadata.queues.filter(queue =>
					matchesSearch(queue, searchTerm, ['name', 'provider'])
				);

				const content = document.getElementById('queues-content');

				if (filteredQueues.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No queues found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredQueues.map(queue => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(queue.name)}</div>
									<span class="badge" style="background: var(--primary);">\${escapeHtml(queue.provider)}</span>
								</div>
								\${queue.description ? \`<div class="card-description">\${escapeHtml(queue.description)}</div>\` : ''}
								\${queue.schema ? \`<div class="detail-section" style="margin-top: 1rem;"><div class="detail-title">Schema</div><div class="code-block">\${escapeHtml(formatJson(queue.schema))}</div></div>\` : ''}
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderSchedulers() {
				if (!metadata?.schedulers) return;

				const searchTerm = document.getElementById('search-schedulers')?.value || '';
				const filteredSchedulers = metadata.schedulers.filter(scheduler =>
					matchesSearch(scheduler, searchTerm, ['name', 'cron'])
				);

				const content = document.getElementById('schedulers-content');

				if (filteredSchedulers.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No schedulers found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredSchedulers.map(scheduler => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(scheduler.name)}</div>
									\${scheduler.lock ? '<span class="badge" style="background: var(--warning);">🔒 Locked</span>' : ''}
								</div>
								\${scheduler.description ? \`<div class="card-description">\${escapeHtml(scheduler.description)}</div>\` : ''}
								<div class="card-meta">
									\${scheduler.cron ? \`<div class="card-meta-item"><span>⏰</span><span class="text-code">\${escapeHtml(scheduler.cron)}</span></div>\` : ''}
									\${scheduler.interval ? \`<div class="card-meta-item"><span>🔄</span><span>\${JSON.stringify(scheduler.interval)}</span></div>\` : ''}
								</div>
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderTopics() {
				if (!metadata?.topics) return;

				const searchTerm = document.getElementById('search-topics')?.value || '';
				const filteredTopics = metadata.topics.filter(topic =>
					matchesSearch(topic, searchTerm, ['name', 'provider'])
				);

				const content = document.getElementById('topics-content');

				if (filteredTopics.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No topics found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredTopics.map(topic => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(topic.name)}</div>
									<span class="badge" style="background: var(--primary);">\${escapeHtml(topic.provider)}</span>
								</div>
								\${topic.description ? \`<div class="card-description">\${escapeHtml(topic.description)}</div>\` : ''}
								\${topic.schema ? \`<div class="detail-section" style="margin-top: 1rem;"><div class="detail-title">Schema</div><div class="code-block">\${escapeHtml(formatJson(topic.schema))}</div></div>\` : ''}
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderBuckets() {
				if (!metadata?.buckets) return;

				const searchTerm = document.getElementById('search-buckets')?.value || '';
				const filteredBuckets = metadata.buckets.filter(bucket =>
					matchesSearch(bucket, searchTerm, ['name', 'provider'])
				);

				const content = document.getElementById('buckets-content');

				if (filteredBuckets.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No buckets found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredBuckets.map(bucket => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(bucket.name)}</div>
									<span class="badge" style="background: var(--primary);">\${escapeHtml(bucket.provider)}</span>
								</div>
								\${bucket.description ? \`<div class="card-description">\${escapeHtml(bucket.description)}</div>\` : ''}
								<div class="card-meta">
									\${bucket.maxSize ? \`<div class="card-meta-item"><span>📦</span><span>Max: \${bucket.maxSize} bytes</span></div>\` : ''}
									\${bucket.mimeTypes?.length ? \`<div class="card-meta-item"><span>📄</span><span>\${bucket.mimeTypes.length} mime types</span></div>\` : ''}
								</div>
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderCaches() {
				if (!metadata?.caches) return;

				const searchTerm = document.getElementById('search-caches')?.value || '';
				const filteredCaches = metadata.caches.filter(cache =>
					matchesSearch(cache, searchTerm, ['name', 'provider'])
				);

				const content = document.getElementById('caches-content');

				if (filteredCaches.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No caches found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredCaches.map(cache => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(cache.name)}</div>
									<div style="display: flex; gap: 0.5rem;">
										<span class="badge" style="background: var(--primary);">\${escapeHtml(cache.provider)}</span>
										\${cache.disabled ? '<span class="badge" style="background: var(--danger);">Disabled</span>' : ''}
									</div>
								</div>
								<div class="card-meta">
									\${cache.ttl ? \`<div class="card-meta-item"><span>⏱️</span><span>TTL: \${JSON.stringify(cache.ttl)}</span></div>\` : ''}
								</div>
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderRealms() {
				if (!metadata?.realms) return;

				const searchTerm = document.getElementById('search-realms')?.value || '';
				const filteredRealms = metadata.realms.filter(realm =>
					matchesSearch(realm, searchTerm, ['name', 'type'])
				);

				const content = document.getElementById('realms-content');

				if (filteredRealms.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No realms found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredRealms.map(realm => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(realm.name)}</div>
									<span class="badge badge-\${realm.type}">\${escapeHtml(realm.type)}</span>
								</div>
								\${realm.description ? \`<div class="card-description">\${escapeHtml(realm.description)}</div>\` : ''}
								\${realm.roles?.length ? \`<div class="card-meta"><div class="card-meta-item"><span>👥</span><span>\${realm.roles.length} roles</span></div></div>\` : ''}
								\${realm.settings ? \`
									<div class="detail-section" style="margin-top: 1rem;">
										<div class="detail-title">Settings</div>
										<div class="property-list">
											\${realm.settings.accessTokenExpiration ? \`<div class="property"><div class="property-key">Access Token</div><div class="property-value">\${JSON.stringify(realm.settings.accessTokenExpiration)}</div></div>\` : ''}
											\${realm.settings.refreshTokenExpiration ? \`<div class="property"><div class="property-key">Refresh Token</div><div class="property-value">\${JSON.stringify(realm.settings.refreshTokenExpiration)}</div></div>\` : ''}
											\${realm.settings.hasOnCreateSession ? \`<div class="property"><div class="property-key">On Create</div><div class="property-value">✓</div></div>\` : ''}
											\${realm.settings.hasOnRefreshSession ? \`<div class="property"><div class="property-key">On Refresh</div><div class="property-value">✓</div></div>\` : ''}
											\${realm.settings.hasOnDeleteSession ? \`<div class="property"><div class="property-key">On Delete</div><div class="property-value">✓</div></div>\` : ''}
										</div>
									</div>
								\` : ''}
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderProviders() {
				if (!metadata?.providers) return;

				const searchTerm = document.getElementById('search-providers')?.value || '';
				const filteredProviders = metadata.providers.filter(provider =>
					matchesSearch(provider, searchTerm, ['name', 'module'])
				);

				const content = document.getElementById('providers-content');

				if (filteredProviders.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No providers found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredProviders.map(provider => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(provider.name)}</div>
								</div>
								\${provider.module ? \`<div class="card-description">📦 \${escapeHtml(provider.module)}</div>\` : ''}
								<div class="card-meta">
									\${provider.dependencies?.length ? \`<div class="card-meta-item"><span>🔗</span><span>\${provider.dependencies.length} dependencies</span></div>\` : ''}
									\${provider.aliases?.length ? \`<div class="card-meta-item"><span>🏷️</span><span>\${provider.aliases.length} aliases</span></div>\` : ''}
								</div>
								\${provider.dependencies?.length ? \`
									<div class="detail-section" style="margin-top: 1rem;">
										<div class="detail-title">Dependencies</div>
										<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
											\${provider.dependencies.map(dep => \`<span class="text-code">\${escapeHtml(dep)}</span>\`).join('')}
										</div>
									</div>
								\` : ''}
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderModules() {
				if (!metadata?.modules) return;

				const searchTerm = document.getElementById('search-modules')?.value || '';
				const filteredModules = metadata.modules.filter(module =>
					matchesSearch(module, searchTerm, ['name'])
				);

				const content = document.getElementById('modules-content');

				if (filteredModules.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">🔍</div><div>No modules found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="card-grid">
						\${filteredModules.map(module => \`
							<div class="card">
								<div class="card-header">
									<div class="card-title">\${escapeHtml(module.name)}</div>
									<span class="badge" style="background: var(--success);">\${module.providers?.length || 0} providers</span>
								</div>
								\${module.providers?.length ? \`
									<div class="detail-section" style="margin-top: 1rem;">
										<div class="detail-title">Providers</div>
										<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
											\${module.providers.map(prov => \`<span class="text-code">\${escapeHtml(prov)}</span>\`).join('')}
										</div>
									</div>
								\` : ''}
							</div>
						\`).join('')}
					</div>
				\`;
			}

			function renderLogs() {
				if (!metadata?.logs) return;

				const searchTerm = document.getElementById('search-logs')?.value || '';
				const level = activeFilters.logs.level;

				const filteredLogs = metadata.logs.filter(log => {
					const matchesLevel = level === 'all' || getLogLevel(log.formatted) === level;
					const matchesSearchTerm = !searchTerm || log.formatted.toLowerCase().includes(searchTerm.toLowerCase());
					return matchesLevel && matchesSearchTerm;
				});

				const content = document.getElementById('logs-content');

				if (filteredLogs.length === 0) {
					content.innerHTML = \`<div class="empty-state"><div class="empty-icon">📋</div><div>No logs found</div></div>\`;
					return;
				}

				content.innerHTML = \`
					<div class="log-container">
						\${filteredLogs.map(log => {
							const level = getLogLevel(log.formatted);
							return \`<div class="log-entry log-\${level}">\${escapeHtml(log.formatted)}</div>\`;
						}).join('')}
					</div>
				\`;
			}

			function renderTab(tabName) {
				if (!metadata) return;

				switch(tabName) {
					case 'overview': renderOverview(); break;
					case 'actions': renderActions(); break;
					case 'pages': renderPages(); break;
					case 'queues': renderQueues(); break;
					case 'schedulers': renderSchedulers(); break;
					case 'topics': renderTopics(); break;
					case 'buckets': renderBuckets(); break;
					case 'caches': renderCaches(); break;
					case 'realms': renderRealms(); break;
					case 'providers': renderProviders(); break;
					case 'modules': renderModules(); break;
					case 'logs': renderLogs(); break;
				}
			}

			// Initialize
			async function init() {
				try {
					const res = await fetch('/_devtools/metadata');
					metadata = await res.json();

					// Update header stats
					document.getElementById('stat-actions').textContent = metadata.actions?.length || 0;
					document.getElementById('stat-pages').textContent = metadata.pages?.length || 0;
					document.getElementById('stat-modules').textContent = metadata.modules?.length || 0;
					document.getElementById('stat-providers').textContent = metadata.providers?.length || 0;

					// Setup method filters for actions
					const methods = [...new Set(metadata.actions?.map(a => a.method) || [])];
					const filterContainer = document.getElementById('filter-actions-methods');
					filterContainer.innerHTML = methods.map(method =>
						\`<button class="filter-btn" data-method="\${method}">\${method}</button>\`
					).join('');

					filterContainer.querySelectorAll('.filter-btn').forEach(btn => {
						btn.addEventListener('click', () => {
							const method = btn.dataset.method;
							if (activeFilters.actions.methods.has(method)) {
								activeFilters.actions.methods.delete(method);
								btn.classList.remove('active');
							} else {
								activeFilters.actions.methods.add(method);
								btn.classList.add('active');
							}
							renderActions();
						});
					});

					// Setup log level filters
					document.querySelectorAll('[data-level]').forEach(btn => {
						btn.addEventListener('click', () => {
							document.querySelectorAll('[data-level]').forEach(b => b.classList.remove('active'));
							btn.classList.add('active');
							activeFilters.logs.level = btn.dataset.level;
							renderLogs();
						});
					});

					// Setup search handlers
					setupSearch('search-actions', renderActions);
					setupSearch('search-pages', renderPages);
					setupSearch('search-queues', renderQueues);
					setupSearch('search-schedulers', renderSchedulers);
					setupSearch('search-topics', renderTopics);
					setupSearch('search-buckets', renderBuckets);
					setupSearch('search-caches', renderCaches);
					setupSearch('search-realms', renderRealms);
					setupSearch('search-providers', renderProviders);
					setupSearch('search-modules', renderModules);
					setupSearch('search-logs', renderLogs);

					// Render initial tab
					renderTab('overview');

				} catch (error) {
					console.error('Failed to load metadata:', error);
					document.querySelectorAll('.loading').forEach(el => {
						el.innerHTML = \`
							<div class="empty-state">
								<div class="empty-icon">⚠️</div>
								<div>Failed to load metadata</div>
								<div style="margin-top: 0.5rem; color: var(--text-muted);">\${escapeHtml(error.message)}</div>
							</div>
						\`;
					});
				}
			}

			init();
		</script>
</body>
</html>`;
