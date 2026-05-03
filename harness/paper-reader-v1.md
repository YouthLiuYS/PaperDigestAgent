# Paper Reader Harness v1

This harness defines how Codex should read each paper before writing `digest` fields back to `public/research-digest/daily.json`.

The user cares most about:

1. Motivation
2. Method
3. Experiments / Results
4. Author affiliations
5. Summary

## Research Direction

Primary research interests:

- AI processor chips and computer architecture
- LLM accelerator architecture
- LLM quantization algorithms and architecture
- LLM software-hardware co-design
- LLM training and inference systems
- KV cache, memory hierarchy, near-memory computing, PIM
- AI accelerator chips, NPU/GPU/TPU, chiplet/3D memory
- Agent hardware-software co-design

Secondary interest:

- Algorithm-level LLM, agent, multimodal, post-training, alignment, and world-model trends.

Hardware/system papers should dominate the daily digest. Algorithm-only papers are useful as trend tracking but should not receive deep-read priority unless they clearly affect efficient LLM execution or hardware/software co-design.

## Reading Protocol

### L0 Metadata Pass

Read:

- title
- authors
- venue/source
- abstract
- categories
- recommendationTrack / relevanceReason
- affiliations / authorAffiliations

Decide whether the paper is:

- `hardware-primary`
- `algorithm-trend`
- `off-topic`

### L1 First Pages Pass

If `localPdfPath` exists and is readable:

- Read only the first two pages first.
- Extract author affiliations if visible.
- Confirm the real problem statement and method positioning.
- Do not infer missing affiliations.

If the PDF is not accessible, write that the evidence is unavailable.

### L2 Evidence Pass

Use only when:

- paper is `hardware-primary`
- or system relevance is high
- or expected `importance >= 4`
- or the abstract does not disclose experiments clearly

Read method/design/evaluation sections when available. Extract only evidence-supported claims.

## Required Fields

The short fields are shown in email:

- `motivationZh`
- `methodZh`
- `experimentsZh`
- `affiliationsZh`
- `summaryZh`

The detailed fields are kept in JSON for deeper reading:

- `motivationDetail`
- `methodDetail`
- `experimentDetail`
- `researchFitZh`
- `whyReadZh`
- `limitationsZh`
- `evidence`
- `confidence`

## Hard Quality Rules

Codex must fail the digest instead of producing vague content when:

- `motivationZh` does not state the concrete problem, importance, gap, and user relevance.
- `methodZh` does not state the core mechanism, components, novelty, and algorithm/system/architecture/hardware nature.
- `experimentsZh` does not state setup, baselines, metrics, main result, or explicitly say the evidence is not disclosed.
- A concrete number appears without `evidence.experimentEvidence`.
- Author affiliations are claimed without `evidence.affiliationEvidence`.
- The output invents datasets, chips, process nodes, baselines, speedups, accuracy, energy, latency, throughput, or affiliations.

When failing:

```json
{
  "workflow": {
    "digestStatus": "failed",
    "emailStatus": "waiting-digest",
    "harnessVersion": "paper-reader-v1",
    "digestError": "short reason"
  }
}
```

When passing:

```json
{
  "workflow": {
    "digestStatus": "ready",
    "emailStatus": "ready",
    "harnessVersion": "paper-reader-v1"
  }
}
```
