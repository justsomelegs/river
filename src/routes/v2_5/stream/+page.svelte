<script lang="ts">
	import type { River } from './+server.js';
	import type { StreamCompletionSummary } from '$lib/v2_5_dev/types.js';
	import { createRiverClient } from '$lib/v2_5_dev/client/index.js';

	type TextAnalyzerChunk = {
		index: number;
		word: string;
		normalized: string;
		length: number;
		vowels: number;
		consonants: number;
		isPalindrome: boolean;
	};

	type AIWorkbenchChunk =
		| {
				type: 'assistant-text';
				text?: string;
		  }
		| {
				type: 'tool-call';
				toolName?: string;
				toolInput?: unknown;
		  }
		| {
				type: 'tool-result';
				toolName?: string;
				toolOutput?: unknown;
				toolInput?: unknown;
		  }
		| { type: 'done' };

	type DiagnosticsChunk = {
		stage: 'start' | 'running' | 'completed';
		message: string;
		ts: number;
	};

	const client = createRiverClient<River>({
		endpoint: '/v2_5/stream',
		retry: {
			attempts: 3,
			delayMs: 1000,
			exponentialBackoff: true
		}
	});

	/* Text Analyzer */
	const textAnalyzer = client.stream.textAnalyzer({
		onStart() {
			analyzerStatus = 'running';
			analyzerChunks = [];
			analyzerSummary = null;
			analyzerError = null;
		},
		onChunk(chunk) {
			analyzerChunks.push(chunk);
		},
		onComplete(summary) {
			analyzerStatus = summary.status;
			analyzerSummary = summary;
		},
		onCancel() {
			analyzerStatus = 'canceled';
		},
		onError(error) {
			analyzerStatus = 'error';
			analyzerError = error instanceof Error ? error.message : 'Unknown error';
		}
	});

	let analyzerStatus = $state<string>('idle');
	let analyzerChunks = $state<TextAnalyzerChunk[]>([]);
	let analyzerSummary = $state<StreamCompletionSummary | null>(null);
	let analyzerError = $state<string | null>(null);
	let analyzerPhrase = $state('River v2.5 showcases resumable streams and plugins.');
	let analyzerRepeat = $state(1);
	let analyzerUppercase = $state(false);

	/* AI Workbench */
	const aiWorkbench = client.stream.aiWorkbench({
		onStart() {
			aiStatus = 'running';
			aiChunks = [];
			aiError = null;
		},
		onChunk(chunk) {
			aiChunks.push(chunk);
		},
		onComplete(summary) {
			aiStatus = summary.status;
		},
		onCancel() {
			aiStatus = 'canceled';
		},
		onError(error) {
			aiStatus = 'error';
			aiError = error instanceof Error ? error.message : 'Unknown error';
		}
	});

	let aiStatus = $state<string>('idle');
	let aiChunks = $state<AIWorkbenchChunk[]>([]);
	let aiError = $state<string | null>(null);
	let aiPrompt = $state('Summarise the key ideas behind River v2.5 for a senior engineer.');
	let aiTone = $state<'neutral' | 'playful' | 'serious'>('neutral');
	let aiRequireTool = $state(true);

	/* Resumable Transcript */
	const transcriptStream = client.stream.resumableTranscript({
		onStart() {
			transcriptStatus = 'running';
			if (!transcriptKeepHistory) {
				transcriptChunks = [];
			} else {
				transcriptChunks = transcriptChunks.map((item) => ({ ...item, isNew: false }));
			}
			transcriptError = null;
		},
		onChunk(chunk) {
			transcriptChunks.push({ chunk, isNew: true });
		},
		onComplete(summary) {
			transcriptStatus = summary.status;
			transcriptRunId = summary.runId;
			transcriptKnownTotal = summary.totalChunks;
			if (summary.totalChunks > transcriptTargetCount) {
				transcriptTargetCount = summary.totalChunks;
			}
		},
		onCancel() {
			transcriptStatus = 'canceled';
		},
		onError(error) {
			transcriptStatus = 'error';
			transcriptError = error instanceof Error ? error.message : 'Unknown error';
		},
		onStreamInfo(info) {
			transcriptRunId = info.runId;
		}
	});

	let transcriptStatus = $state<string>('idle');
	let transcriptChunks = $state<Array<{ chunk: { index: number; data: string }; isNew: boolean }>>(
		[]
	);
	let transcriptError = $state<string | null>(null);
	let transcriptRunId = $state<string | null>(null);
	let transcriptKeepHistory = $state(true);
	let transcriptUseStableId = $state(true);
	let transcriptStableId = $state('river-v2_5-resume');
	let transcriptTargetCount = $state(30);
	let transcriptKnownTotal = $state(0);

	const startTranscript = (count: number, runId?: string) => {
		const target = Math.max(transcriptKnownTotal, Math.max(1, count));
		transcriptTargetCount = target;
		transcriptStream.start({ count: target }, { runId });
	};

	/* Diagnostics Stream */
	const diagnosticsStream = client.stream.diagnosticsStream({
		onStart() {
			diagnosticsStatus = 'running';
			diagnosticsChunks = [];
			diagnosticsError = null;
			diagnosticsSummary = null;
		},
		onChunk(chunk) {
			diagnosticsChunks.push(chunk as DiagnosticsChunk);
		},
		onComplete(summary) {
			diagnosticsStatus = summary.status;
			diagnosticsSummary = summary;
		},
		onCancel() {
			diagnosticsStatus = 'canceled';
		},
		onError(error) {
			diagnosticsStatus = 'error';
			diagnosticsError = error instanceof Error ? error.message : 'Unknown error';
		}
	});

	let diagnosticsStatus = $state<string>('idle');
	let diagnosticsChunks = $state<DiagnosticsChunk[]>([]);
	let diagnosticsError = $state<string | null>(null);
	let diagnosticsSummary = $state<StreamCompletionSummary | null>(null);
	let diagnosticsMode = $state<'success' | 'fail-chunk' | 'throw-error'>('fail-chunk');
</script>

<div class="mx-auto grid max-w-5xl gap-6 p-6">
	<div class="space-y-2">
		<h1 class="text-3xl font-bold">River v2.5 Demo Suite</h1>
		<p class="text-neutral-400">
			Hands-on scenarios covering validation, plugins, AI tooling, resumable storage, and error
			handling in the v2.5 server/client runtime.
		</p>
	</div>

	<section class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<header class="space-y-1">
			<h2 class="text-xl font-semibold">1. Text Analyzer (validation + plugin context)</h2>
			<p class="text-sm text-neutral-400">
				Checks schema validation, before/after hooks, throttling, and run metrics logging.
			</p>
		</header>

		<div class="flex flex-wrap gap-2">
			<input
				bind:value={analyzerPhrase}
				class="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
				placeholder="Text to analyze..."
				disabled={analyzerStatus === 'running'}
			/>
			<label class="flex items-center gap-2 text-sm text-neutral-300">
				<span>Repeat:</span>
				<input
					type="range"
					min="1"
					max="5"
					bind:value={analyzerRepeat}
					disabled={analyzerStatus === 'running'}
				/>
				<span class="w-6 text-right">{analyzerRepeat}</span>
			</label>
			<label class="flex items-center gap-2 text-sm text-neutral-300">
				<input
					type="checkbox"
					bind:checked={analyzerUppercase}
					disabled={analyzerStatus === 'running'}
				/>
				<span>Uppercase first</span>
			</label>
		</div>

		<div class="flex gap-2">
			<button
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={analyzerStatus === 'running'}
				onclick={() =>
					textAnalyzer.start({
						phrase: analyzerPhrase,
						repeat: Number(analyzerRepeat),
						uppercase: analyzerUppercase
					})}
			>
				{analyzerStatus === 'running' ? 'Running…' : 'Start'}
			</button>
			<button
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={analyzerStatus !== 'running'}
				onclick={() => textAnalyzer.stop()}
			>
				Stop
			</button>
			<button
				class="rounded bg-neutral-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={analyzerStatus === 'running'}
				onclick={() => {
					analyzerChunks = [];
					analyzerSummary = null;
					analyzerError = null;
					analyzerStatus = 'idle';
				}}
			>
				Clear
			</button>
		</div>

		<div class="text-sm text-neutral-300">
			<div>
				Status: <span class="rounded bg-neutral-800 px-2 py-1">{analyzerStatus}</span>
				Chunks: <span class="rounded bg-neutral-800 px-2 py-1">{analyzerChunks.length}</span>
			</div>
			{#if analyzerSummary}
				<div class="text-xs text-neutral-500">
					runId: {analyzerSummary.runId.slice(0, 8)}… · duration: {analyzerSummary.durationMs}ms
				</div>
			{/if}
		</div>

		{#if analyzerError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{analyzerError}</div>
		{/if}

		{#if analyzerChunks.length > 0}
			<div class="overflow-x-auto rounded border border-neutral-800">
				<table class="w-full text-left text-sm">
					<thead class="bg-neutral-800 text-xs text-neutral-400 uppercase">
						<tr>
							<th class="px-3 py-2">#</th>
							<th class="px-3 py-2">Word</th>
							<th class="px-3 py-2">Normalized</th>
							<th class="px-3 py-2">Len</th>
							<th class="px-3 py-2">Vowels</th>
							<th class="px-3 py-2">Consonants</th>
							<th class="px-3 py-2">Palindrome?</th>
						</tr>
					</thead>
					<tbody>
						{#each analyzerChunks as chunk}
							<tr class="border-t border-neutral-800">
								<td class="px-3 py-2 text-neutral-500">{chunk.index}</td>
								<td class="px-3 py-2">{chunk.word}</td>
								<td class="px-3 py-2 font-mono text-xs text-neutral-400">
									{chunk.normalized}
								</td>
								<td class="px-3 py-2">{chunk.length}</td>
								<td class="px-3 py-2">{chunk.vowels}</td>
								<td class="px-3 py-2">{chunk.consonants}</td>
								<td class="px-3 py-2">
									{chunk.isPalindrome ? 'Yes' : 'No'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<header class="space-y-1">
			<h2 class="text-xl font-semibold">2. AI Workbench (AI plugin + tool calls)</h2>
			<p class="text-sm text-neutral-400">
				Streams AI output while surfacing tool-call and tool-result chunks from the AI plugin.
			</p>
		</header>

		<div class="grid gap-3 md:grid-cols-[2fr_1fr]">
			<!-- svelte-ignore element_invalid_self_closing_tag -->
			<textarea
				bind:value={aiPrompt}
				class="min-h-[120px] rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
				placeholder="Ask the assistant something…"
				disabled={aiStatus === 'running'}
			/>
			<div class="space-y-2 text-sm text-neutral-300">
				<label class="flex items-center justify-between gap-2">
					<span>Tone</span>
					<select
						bind:value={aiTone}
						class="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
						disabled={aiStatus === 'running'}
					>
						<option value="neutral">Neutral</option>
						<option value="playful">Playful</option>
						<option value="serious">Serious</option>
					</select>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span>Enable fact-check tool</span>
					<input type="checkbox" bind:checked={aiRequireTool} disabled={aiStatus === 'running'} />
				</label>
			</div>
		</div>

		<div class="flex gap-2">
			<button
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={aiStatus === 'running'}
				onclick={() =>
					aiWorkbench.start({
						prompt: aiPrompt,
						tone: aiTone,
						requireTool: aiRequireTool
					})}
			>
				{aiStatus === 'running' ? 'Streaming…' : 'Start'}
			</button>
			<button
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={aiStatus !== 'running'}
				onclick={() => aiWorkbench.stop()}
			>
				Stop
			</button>
			<button
				class="rounded bg-neutral-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={aiStatus === 'running'}
				onclick={() => {
					aiChunks = [];
					aiError = null;
					aiStatus = 'idle';
				}}
			>
				Clear
			</button>
		</div>

		<div class="text-sm text-neutral-300">
			Status: <span class="rounded bg-neutral-800 px-2 py-1">{aiStatus}</span>
			Chunks: <span class="rounded bg-neutral-800 px-2 py-1">{aiChunks.length}</span>
		</div>

		{#if aiError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{aiError}</div>
		{/if}

		{#if aiChunks.length > 0}
			<div class="space-y-2 rounded border border-neutral-800 bg-neutral-950/60 p-3 text-sm">
				{#each aiChunks as chunk, index}
					<div class="space-y-1 rounded border border-neutral-800 bg-neutral-900 p-2">
						<div class="flex items-center justify-between text-xs text-neutral-500">
							<span>#{index + 1}</span>
							<span class="uppercase">{chunk.type}</span>
						</div>
						{#if chunk.type === 'assistant-text'}
							<p class="whitespace-pre-wrap text-neutral-200">{chunk.text}</p>
						{:else if chunk.type === 'tool-call'}
							<p class="font-mono text-xs text-blue-300">
								tool-call → {chunk.toolName}: {JSON.stringify(chunk.toolInput)}
							</p>
						{:else if chunk.type === 'tool-result'}
							<div class="space-y-1 font-mono text-xs text-green-300">
								<div>tool-result ← {chunk.toolName}</div>
								<div>{JSON.stringify(chunk.toolOutput)}</div>
							</div>
						{:else if chunk.type === 'done'}
							<p class="text-xs text-neutral-500">Stream completed.</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<header class="space-y-1">
			<h2 class="text-xl font-semibold">3. Resumable Transcript (storage + resume)</h2>
			<p class="text-sm text-neutral-400">
				In-memory storage adapter with resumable runIds. Stop mid-stream and continue from where you
				left off.
			</p>
		</header>

		<div class="space-y-2 rounded border border-blue-800 bg-blue-900/20 p-2 text-xs">
			<div>
				<strong>Tip:</strong> Run with a stable runId, stop mid-way, then resume or extend the target
				count.
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={transcriptUseStableId} class="rounded" />
				<span>Use stable runId (enables resumption)</span>
			</label>
			{#if transcriptUseStableId}
				<input
					bind:value={transcriptStableId}
					class="w-full rounded border border-blue-700 bg-blue-950 px-2 py-1 font-mono text-xs"
					placeholder="Stable runId…"
				/>
			{/if}
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={transcriptKeepHistory} class="rounded" />
				<span>Keep old chunks on resume (highlight new ones)</span>
			</label>
			<div class="flex flex-wrap items-center gap-2">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-neutral-300">Target chunks:</label>
				<input
					type="number"
					min="1"
					bind:value={transcriptTargetCount}
					class="w-24 rounded border border-blue-700 bg-blue-950 px-2 py-1 text-xs"
				/>
				<button
					class="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50"
					disabled={transcriptStatus === 'running' || (!transcriptUseStableId && !transcriptRunId)}
					onclick={() => {
						const next = Math.max(Number(transcriptTargetCount) || 0, transcriptKnownTotal) + 10;
						startTranscript(
							next,
							transcriptUseStableId ? transcriptStableId : (transcriptRunId ?? undefined)
						);
					}}
				>
					Continue +10
				</button>
			</div>
		</div>

		<div class="flex gap-2">
			<button
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={transcriptStatus === 'running'}
				onclick={() =>
					startTranscript(
						Number(transcriptTargetCount) || 0,
						transcriptUseStableId ? transcriptStableId : undefined
					)}
			>
				{transcriptStatus === 'running' ? 'Streaming…' : 'Start'}
			</button>
			<button
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={transcriptStatus !== 'running'}
				onclick={() => transcriptStream.stop()}
			>
				Stop
			</button>
			<button
				class="rounded bg-neutral-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={transcriptStatus === 'running'}
				onclick={() => {
					transcriptChunks = [];
					transcriptStatus = 'idle';
					transcriptError = null;
					transcriptKnownTotal = 0;
				}}
			>
				Clear
			</button>
		</div>

		<div class="space-y-1 text-sm text-neutral-300">
			<div>
				Status: <span class="rounded bg-neutral-800 px-2 py-1">{transcriptStatus}</span>
				Chunks: <span class="rounded bg-neutral-800 px-2 py-1">{transcriptChunks.length}</span>
				Stored total:
				<span class="rounded bg-neutral-800 px-2 py-1">{transcriptKnownTotal}</span>
			</div>
			{#if transcriptRunId}
				<div class="font-mono text-xs text-neutral-500">
					runId: {transcriptRunId.slice(0, 10)}…
				</div>
			{/if}
		</div>

		{#if transcriptError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{transcriptError}</div>
		{/if}

		{#if transcriptChunks.length > 0}
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				{#each transcriptChunks as item}
					<div
						class="rounded border border-neutral-800 p-2 text-sm"
						class:bg-green-800={item.isNew}
						class:bg-neutral-800={!item.isNew}
					>
						<div class="text-xs text-neutral-400">#{item.chunk.index}</div>
						<div>{item.chunk.data}</div>
						<div class="text-[10px] text-neutral-500">
							{item.isNew ? 'new chunk' : 'cached'}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<header class="space-y-1">
			<h2 class="text-xl font-semibold">4. Diagnostics Stream (error paths)</h2>
			<p class="text-sm text-neutral-400">
				Trigger validation failures or thrown errors to exercise error, cancel, and success paths.
			</p>
		</header>

		<div class="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
			<label class="flex items-center gap-2">
				<span>Mode</span>
				<select
					bind:value={diagnosticsMode}
					class="rounded border border-neutral-700 bg-neutral-800 px-2 py-1"
					disabled={diagnosticsStatus === 'running'}
				>
					<option value="success">Success</option>
					<option value="fail-chunk">Fail chunk validation</option>
					<option value="throw-error">Throw error</option>
				</select>
			</label>
		</div>

		<div class="flex gap-2">
			<button
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={diagnosticsStatus === 'running'}
				onclick={() => diagnosticsStream.start({ mode: diagnosticsMode })}
			>
				{diagnosticsStatus === 'running' ? 'Streaming…' : 'Start'}
			</button>
			<button
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={diagnosticsStatus !== 'running'}
				onclick={() => diagnosticsStream.stop()}
			>
				Stop
			</button>
			<button
				class="rounded bg-neutral-600 px-4 py-2 text-white disabled:opacity-50"
				disabled={diagnosticsStatus === 'running'}
				onclick={() => {
					diagnosticsChunks = [];
					diagnosticsStatus = 'idle';
					diagnosticsError = null;
					diagnosticsSummary = null;
				}}
			>
				Clear
			</button>
		</div>

		<div class="text-sm text-neutral-300">
			Status: <span class="rounded bg-neutral-800 px-2 py-1">{diagnosticsStatus}</span>
			Chunks: <span class="rounded bg-neutral-800 px-2 py-1">{diagnosticsChunks.length}</span>
		</div>

		{#if diagnosticsSummary}
			<div class="text-xs text-neutral-500">
				runId: {diagnosticsSummary.runId.slice(0, 8)}… · duration:
				{diagnosticsSummary.durationMs}ms
			</div>
		{/if}

		{#if diagnosticsError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{diagnosticsError}</div>
		{/if}

		{#if diagnosticsChunks.length > 0}
			<div class="space-y-2 text-sm">
				{#each diagnosticsChunks as chunk}
					<div class="rounded border border-neutral-800 bg-neutral-900 p-2">
						<div class="text-xs text-neutral-500">
							{new Date(chunk.ts).toLocaleTimeString()} · {chunk.stage.toUpperCase()}
						</div>
						<div>{chunk.message}</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="rounded-lg border border-green-700 bg-green-900/20 p-4">
		<h2 class="mb-3 text-xl font-semibold text-green-400">✅ v2.5 Feature Checklist</h2>
		<ul class="space-y-1 text-sm text-neutral-300">
			<li>• Schema validation + throttled streaming (`textAnalyzer`)</li>
			<li>• beforeRun/afterRun hooks with run metrics logging</li>
			<li>• AI plugin with tool calls and streamed deltas (`aiWorkbench`)</li>
			<li>• Resumable storage adapter with runId continuity (`resumableTranscript`)</li>
			<li>• Error vs validation failure scenarios (`diagnosticsStream`)</li>
			<li>• SSE lifecycle events, retry hints, and client reconnection (all streams)</li>
			<li>• Server CORS + heartbeat configuration (`riverConfig` options)</li>
		</ul>
	</section>
</div>
