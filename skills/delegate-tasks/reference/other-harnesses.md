# delegate-tasks on other agents

The method is the same everywhere — triage, specs, waves, fence check, command
gates, at most three fix rounds, integration by the session that wrote the specs.
Only the execution engine changes.

## ZCode — dynamic workflow

ZCode pins a builder model only on a dynamic workflow (`subagent_model`); ad-hoc
subagents run on the session model. Load ZCode's `dynamic-workflows` skill before
`CreateWorkflow`. Set `subagent_model` to the cheaper tier the user names, or the
project's `builders-model:` line in `AGENTS.md`; resolve the id against
`ListModels`. One run uses one builder model. Check that model reads images
before giving it visual specs.

Lessons from about a dozen real runs, already folded into the template below:

- **Pin the repository root.** A run's workspace once resolved to the spec
  directory and created a nested `.zcode/` there. Every command runs as
  `sh -c "cd <ROOT> && …"`.
- **A phase filter that selects zero specs is an error, not an empty phase.** A
  draft's filter `/^[0678]-/` could never match `06-`, so a whole phase
  dispatched no builders and reported green.
- **Keep gate output small.** A green gate's log once exceeded the run's stdout
  cap and failed the step; use errors-only reporters.
- **Count gates** where the spec promises counts: `grep -c` per file, compared
  to the expected map, one violation fails the gate.
- Fixers are fenced: "if the fix belongs outside these files, report that
  instead of editing."

```ts
interface TaskResult {
  /** Files this builder created or modified. */
  files: string[];
  /** "done" when the spec's acceptance commands passed; "blocked" when the spec was incomplete. */
  status: "done" | "blocked";
  /** What could not be done and why — empty when done. */
  blockers: string;
}

const ROOT = "/absolute/path/to/repo"; // [B] pinned — never rely on the workspace
const RUN = ".zcode/tasks/<run-id>";   // [B] one directory per run
const BUILDER =
  "A careful implementing engineer. Follow the spec exactly; when the spec and the code " +
  "disagree, report the conflict instead of improvising; never modify a test to pass; " +
  "escalate when truly stuck rather than faking progress.";

function ask(spec: string): string {
  return (
    `Read ${spec} and implement it exactly. Read every source file it references first. ` +
    `Run each acceptance command in the spec and fix until they pass — never report a check ` +
    `you did not run. Edit only the spec's Files list. Do not commit. Run only the spec's own ` +
    `commands, not the whole suite. If the spec contradicts the code or is missing something, ` +
    `set status "blocked" and explain instead of guessing.`
  );
}

const all = await files.glob(`${RUN}/0*.md`);
const wave = (re: RegExp) => all.filter((p) => re.test(p.split("/").pop() ?? ""));
const waves = [wave(/^0[1]-/), wave(/^0[2-9]-/)]; // [B] wave 0 = contracts and copy

for (const [i, specs] of waves.entries()) {
  if (specs.length === 0) throw new Error(`wave ${i} selected no specs — check the filter`);
}

const results: TaskResult[] = [];
for (const [i, specs] of waves.entries()) {
  phase(`Wave ${i}: ${specs.length} builder(s)`);
  const done = await Promise.all(
    specs.map((s) => agent(`builder ${s.split("/").pop()}`, { system: BUILDER }).ask<TaskResult>(ask(s))),
  );
  results.push(...done);
  if (i === 0 && done.some((r) => r.status === "blocked")) break; // a blocked contract stops the run
}

phase("Gate the combined result");
const gate = () => world.run("sh", ["-c", `cd ${ROOT} && npm run -s typecheck && npm test -- --reporter=dot`], { timeoutMs: 600_000 }); // [B]
let g = await gate();
for (let round = 1; round <= 3 && g.exitCode !== 0; round++) {
  await agent(`fixer round ${round}`, { system: BUILDER }).ask(
    `The gate failed:\n${g.stderr.slice(-4000)}\nFix the cause within the specs' Files lists. ` +
      `If the fix belongs elsewhere, report that instead of editing. Do not commit.`,
  );
  g = await gate();
}
return { built: results.filter((r) => r.status === "done").length, total: all.length, gateGreen: g.exitCode === 0, results };
```

`world.run` command names are compile-time literals; runtime values go in the
arguments array. Back in the main session, run the fence check and the full suite
yourself, then integrate (Phase D).

## Codex

No workflow engine is needed. Run one non-interactive builder per spec, each in
the background, then gate in the main session:

```sh
codex exec -s workspace-write -o .review-work/builders/01.md - < .claude/tasks/<run-id>/01-slug.brief.md
```

- The brief file is the builder brief from `SKILL.md` with the spec path filled
  in. The prompt goes on **stdin**; a quoted-argument prompt hung.
- The CLI exits 0 on failure. Count a builder as finished only if its output
  file is non-empty and names a `STATUS`.
- Codex reads `AGENTS.md` but not Claude-specific rule folders; inline any rule
  the spec needs.

## Kimi

Where its CLI offers a non-interactive mode, treat it like Codex: one builder per
spec, the brief on stdin, the gates and the fence check in the session. Otherwise
run the specs sequentially in the session and keep the same gates.
