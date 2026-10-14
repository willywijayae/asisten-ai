import test from "node:test";
import assert from "node:assert/strict";
import { buildDelegationPrompt, parseHermesResult, runDelegation } from "./hermes-delegation.mjs";

test("prompt mewajibkan satu sub-agent terisolasi", () => {
  const prompt = buildDelegationPrompt({
    specialist: "copywriter",
    specialistName: "Copywriter",
    brief: "Tulis copy iklan.",
    request: "Buat lima hook.",
    context: "Produk A untuk ibu muda.",
  });
  assert.match(prompt, /delegate_task/);
  assert.match(prompt, /tepat satu sub-agent/i);
  assert.match(prompt, /output_schema/i);
  assert.match(prompt, /"result"/i);
  assert.match(prompt, /Copywriter/);
  assert.match(prompt, /Buat lima hook/);
  assert.match(prompt, /Produk A/);
});

test("hasil dibaca dari tool_result sub-agent yang sukses", () => {
  const stdout = [
    JSON.stringify({ type: "tool_use", name: "delegate_task" }),
    JSON.stringify({
      type: "tool_result",
      name: "delegate_task",
      is_error: false,
      output: JSON.stringify({ results: [{ status: "completed", schema_valid: true, summary: JSON.stringify({ result: "Laporan final" }) }] }),
    }),
    JSON.stringify({ type: "result", exit_code: 0, text: "Jawaban orchestrator" }),
  ].join("\n");
  assert.equal(parseHermesResult(stdout), "Laporan final");
});

test("result sub-agent harus string", () => {
  const stdout = [
    JSON.stringify({ type: "tool_use", name: "delegate_task" }),
    JSON.stringify({
      type: "tool_result", name: "delegate_task", is_error: false,
      output: JSON.stringify({ results: [{ status: "completed", schema_valid: true, summary: JSON.stringify({ result: { teks: "salah" } }) }] }),
    }),
  ].join("\n");
  assert.throws(() => parseHermesResult(stdout), /harus string/i);
});

test("tool_result sub-agent gagal ditolak walau orchestrator menjawab", () => {
  const stdout = [
    JSON.stringify({ type: "tool_use", name: "delegate_task" }),
    JSON.stringify({
      type: "tool_result",
      name: "delegate_task",
      is_error: true,
      output: JSON.stringify({ results: [{ status: "failed", summary: "gagal" }] }),
    }),
    JSON.stringify({ type: "result", exit_code: 0, text: "Jawaban buatan orchestrator" }),
  ].join("\n");
  assert.throws(() => parseHermesResult(stdout), /sub-agent gagal/i);
});


test("lebih dari satu sub-agent ditolak", () => {
  const child = JSON.stringify({
    type: "tool_result", name: "delegate_task", is_error: false,
    output: JSON.stringify({ results: [{ status: "completed", schema_valid: true, summary: JSON.stringify({ result: "Hasil" }) }] }),
  });
  const stdout = [
    JSON.stringify({ type: "tool_use", name: "delegate_task" }),
    JSON.stringify({ type: "tool_use", name: "delegate_task" }),
    child,
    child,
  ].join("\n");
  assert.throws(() => parseHermesResult(stdout), /tepat satu sub-agent/i);
});

test("tool_result berisi beberapa child ditolak", () => {
  const child = { status: "completed", schema_valid: true, summary: JSON.stringify({ result: "Hasil" }) };
  const stdout = [
    JSON.stringify({ type: "tool_use", name: "delegate_task" }),
    JSON.stringify({
      type: "tool_result", name: "delegate_task", is_error: false,
      output: JSON.stringify({ results: [child, child] }),
    }),
  ].join("\n");
  assert.throws(() => parseHermesResult(stdout), /tepat satu sub-agent/i);
});

test("tool_use tanpa tool_result sukses ditolak", () => {
  const stdout = [
    JSON.stringify({ type: "tool_use", name: "delegate_task" }),
    JSON.stringify({ type: "result", exit_code: 0, text: "Jawaban orchestrator" }),
  ].join("\n");
  assert.throws(() => parseHermesResult(stdout), /hasil sub-agent/i);
});


test("single-flight menolak delegasi kedua selama delegasi pertama berjalan", async () => {
  const { createSingleFlight } = await import("./hermes-delegation.mjs");
  let release;
  const first = createSingleFlight(() => new Promise((resolve) => { release = resolve; }));
  const running = first();
  await assert.rejects(first(), /sedang sibuk/i);
  release("selesai");
  assert.equal(await running, "selesai");
});

test("hasil tanpa delegate_task ditolak", () => {
  const stdout = JSON.stringify({ type: "result", exit_code: 0, text: "Jawaban langsung" });
  assert.throws(() => parseHermesResult(stdout), /tidak mendelegasikan/i);
});

test("runner memakai model Opus khusus bila diminta", async () => {
  let model;
  await runDelegation(
    { specialist: "konten", specialistName: "Perencana Konten", brief: "Buat rencana.", request: "Kalender konten.", context: "", model: "content-opus" },
    async (_command, args) => {
      model = args[args.indexOf("--model") + 1];
      return {
        stdout: JSON.stringify({ type: "tool_use", name: "delegate_task" }),
        stderr: JSON.stringify({
          type: "tool_result", name: "delegate_task", is_error: false,
          output: JSON.stringify({ results: [{ status: "completed", schema_valid: true, summary: JSON.stringify({ result: "Rencana" }) }] }),
        }),
      };
    },
  );
  assert.equal(model, "content-opus");
});

test("runner memakai toolset delegation dan mengirim prompt lewat stdin", async () => {
  let seen;
  const result = await runDelegation(
    { specialist: "riset", specialistName: "Riset", brief: "Riset pasar.", request: "Petakan pasar.", context: "" },
    async (command, args, options) => {
      seen = { command, args, options };
      return {
        stdout: JSON.stringify({ type: "tool_use", name: "delegate_task" }),
        stderr: [
          JSON.stringify({
            type: "tool_result", name: "delegate_task", is_error: false,
            output: JSON.stringify({ results: [{ status: "completed", schema_valid: true, summary: JSON.stringify({ result: "Peta pasar" }) }] }),
          }),
          JSON.stringify({ type: "result", exit_code: 0, text: "Peta pasar" }),
        ].join("\n"),
      };
    },
  );
  assert.equal(result, "Peta pasar");
  assert.equal(seen.command, `${process.env.HOME}/.local/bin/hermes`);
  assert.deepEqual(seen.args.slice(0, 5), ["chat", "--query-file", "-", "--format", "stream-json"]);
  assert.ok(seen.args.includes("delegation"));
  assert.equal(seen.args[seen.args.indexOf("--model") + 1], "smart-hard-claude");
  assert.match(seen.options.input, /Petakan pasar/);
  assert.equal(seen.options.timeout, 230_000);
});
