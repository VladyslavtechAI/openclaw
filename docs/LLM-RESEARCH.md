# Building Custom Local LLMs for Business and Coding Tasks

> **Research document — March 2026**
> Covers open-source models, training/fine-tuning, inference, RAG, integration strategy, and build-vs-buy analysis.

---

## Table of Contents

1. [Current State of Open-Source LLMs](#1-current-state-of-open-source-llms-march-2026)
2. [Training Your Own LLM](#2-training-your-own-llm)
3. [Inference & Deployment](#3-inference--deployment)
4. [RAG Architecture for Business](#4-rag-architecture-for-business)
5. [Recommended Stack for Integration](#5-recommended-stack-for-integration)
6. [Build vs Buy Analysis](#6-build-vs-buy-analysis)
7. [Practical Roadmap](#7-practical-roadmap)

---

## 1. Current State of Open-Source LLMs (March 2026)

### 1.1 Key Trend: MoE Dominance

Every major frontier open-weight LLM released in late 2025/early 2026 uses **Mixture-of-Experts (MoE)**. Dense models remain relevant only at smaller sizes (sub-32B). This means frontier-quality models can run with a fraction of their total parameters active per token.

### 1.2 Best Models by Size

#### Sub-3B Parameters (Edge / Mobile)

| Model | Total/Active | Architecture | Context | Release | License |
|---|---|---|---|---|---|
| Qwen3-0.6B | 0.6B dense | Transformer | 32K | Apr 2025 | Apache 2.0 |
| Qwen3.5-0.8B | 0.8B dense | Gated Delta Net + MoE | 32K | Mar 2026 | Apache 2.0 |
| Gemma 3-1B | 1B dense | Transformer | 32K | Mar 2025 | Gemma license |
| Qwen3.5-2B | 2B dense | Gated Delta Net + MoE | 32K | Mar 2026 | Apache 2.0 |

#### 3B-4B Parameters (On-Device)

| Model | Total/Active | Architecture | Context | Release | License |
|---|---|---|---|---|---|
| Qwen3-4B | 4B dense | Transformer | 32K | Apr 2025 | Apache 2.0 |
| Gemma 3-4B | 4B dense | Transformer | 128K | Mar 2025 | Gemma license |
| Ministral 3B | 3B dense | Transformer | -- | Dec 2025 | Apache 2.0 |
| **Qwen3-30B-A3B** | **30B total / 3B active** | **MoE** | **128K** | Apr 2025 | Apache 2.0 |
| Nemotron 3 Nano | 31.6B total / 3.2B active | Hybrid Mamba-Transformer MoE | 1M | Late 2025 | Open |

**Standout:** Qwen3-30B-A3B scores 69.6% on SWE-Bench Verified and 91.0 on ArenaHard despite only activating 3B parameters per token. Nemotron 3 Nano supports a 1M-token context window.

#### 7B-14B Parameters (Single GPU)

| Model | Total/Active | Architecture | Context | Release | License |
|---|---|---|---|---|---|
| Qwen3-8B | 8B dense | Transformer | 128K | Apr 2025 | Apache 2.0 |
| Qwen3.5-9B | 9B dense | Gated Delta Net + MoE | 128K | Mar 2026 | Apache 2.0 |
| Qwen3-14B | 14B dense | Transformer | 128K | Apr 2025 | Apache 2.0 |
| Gemma 3-12B | 12B dense | Transformer | 128K | Mar 2025 | Gemma license |
| Phi-4 | 14B dense | Transformer | 16K | Dec 2024 | MIT |
| Phi-4-reasoning | 14B dense | Transformer | 16K | Apr 2025 | MIT |
| Ministral 8B/14B | 8B/14B dense | Transformer | -- | Dec 2025 | Apache 2.0 |

**Standouts:**
- **Qwen3.5-9B** achieves MMLU-Pro 82.5, outperforming GPT-OSS-120B (80.8) at a fraction of the size.
- **Phi-4-reasoning** (14B) scores 75.3% on AIME 2024, beating DeepSeek-R1-Distill-70B (69.3%).
- **Ministral 14B Reasoning** achieves ~85% on AIME 2025.

#### 27B-32B Parameters

| Model | Params | Architecture | Context | License |
|---|---|---|---|---|
| Qwen3-32B | 32B dense | Transformer | 128K | Apache 2.0 |
| Gemma 3-27B | 27B dense | Transformer | 128K | Gemma license |

#### 70B+ / Frontier MoE Models

| Model | Total / Active | Architecture | Context | Release | License |
|---|---|---|---|---|---|
| **Kimi K2.5** | 1T / 32B | MoE (384 experts, 8 active) + MLA | 256K | Jan 2026 | MIT |
| **GLM-5** | 744B / ~44B | MoE | 200K | Feb 2026 | MIT |
| **DeepSeek V3.2** | 671B / 37B | MoE + DSA | 128K | Dec 2025 | MIT |
| **Mistral Large 3** | 675B / 41B | MoE | 256K | Dec 2025 | Apache 2.0 |
| **Qwen3-235B-A22B** | 235B / 22B | MoE | 128K | Apr 2025 | Apache 2.0 |
| **Qwen3.5-397B-A17B** | 397B / 17B | Gated Delta Net + MoE | 128K | Feb 2026 | Apache 2.0 |
| **MiMo-V2-Flash** | 309B / 15B | MoE + Hybrid Attention | 128K | Dec 2025 | Open weights |
| **GPT-oss-120B** | 117B / 5.1B | MoE (128 experts, Top-4) | -- | Aug 2025 | Apache 2.0 |
| **Llama 4 Scout** | 109B / 17B | MoE | 10M | Apr 2025 | Llama license |
| **Llama 4 Maverick** | 400B / 17B | MoE | 1M | Apr 2025 | Llama license |
| **Nemotron 3 Super** | 120B / 12B | Hybrid Mamba-Transformer MoE | 1M | H1 2026 | Open |

### 1.3 Frontier Benchmark Leaderboard (March 2026)

| Benchmark | Top Open Model | Score |
|---|---|---|
| HumanEval | Kimi K2.5 | 99.0% |
| SWE-bench Verified | GLM-5 | 77.8% |
| AIME 2025 (Math) | Kimi K2.5 | 96.1% |
| GPQA Diamond (Science) | Qwen 3.5 | 88.4% |
| LiveCodeBench | DeepSeek V3.2 Speciale | 90.0% |
| Chatbot Arena Elo | GLM-5 | 1,451 |
| MMLU | Kimi K2.5 | 92.0% |
| MATH-500 | Kimi K2.5 | 98.0% |
| Humanity's Last Exam | GLM-5 | 50.4% |

### 1.4 Coding-Specific Models

| Model | Size | SWE-bench | HumanEval | Key Feature |
|---|---|---|---|---|
| **Qwen3-Coder-480B-A35B** | 480B/35B MoE | 66.5% | -- | 256K native, 1M extrapolated, Agent RL training |
| **MiMo-V2-Flash** | 309B/15B MoE | #1 open-source | -- | 3.5% cost of Claude Sonnet 4.5 |
| **Kimi K2.5** | 1T/32B MoE | 76.8% | 99.0% | Best open-model coding overall |
| **GLM-4.7** | ~400B | -- | 94.2% | Multi-file software engineering |
| **DeepSeek V3.2** | 671B/37B MoE | -- | -- | LiveCodeBench 90.0% (Speciale) |
| StarCoder 2-15B | 15B dense | -- | 46.3% | 600+ languages, largely superseded |

**Key insight:** Dedicated coding models (StarCoder, WizardCoder) have been largely superseded by general-purpose frontier models that also excel at code. Qwen3-Coder is the exception with its agent-RL training on 20K parallel environments.

### 1.5 Reasoning Models

| Model | Size | AIME 2024 | MATH-500 | Key Innovation |
|---|---|---|---|---|
| DeepSeek-R1 | 671B/37B MoE | 79.8% | 97.3% | Pure RL without SFT |
| DeepSeek V3.1 | 671B/37B MoE | -- | -- | Hybrid thinking/non-thinking modes |
| DeepSeek V3.2 Speciale | 671B/37B MoE | -- | -- | Gold-medal 2025 IMO/IOI |
| Phi-4-reasoning-plus | 14B dense | 81.3% | -- | Remarkably strong for 14B |
| Kimi K2.5 | 1T/32B MoE | -- | 98.0% | Best open model by Artificial Analysis |
| GLM-5 | 744B/~44B MoE | -- | -- | "Slime" RL reduces hallucination 90%->34% |

**Key development:** Most model families now offer hybrid thinking/non-thinking modes (Qwen3, DeepSeek V3.1+), letting a single model handle both quick responses and deep reasoning.

### 1.6 Architecture Innovations

**Mixture-of-Experts design choices vary widely:**
- Expert count: 16 (Llama 4) to 384 (Kimi K2.5)
- Shared experts: DeepSeek, Llama 4, Kimi K2 include a shared expert processing every token
- Routing: Top-1 (Llama 4), Top-4 (GPT-oss), Top-8 (Kimi K2.5)
- Llama 4 alternates dense and MoE layers (unique approach)

**Other innovations:**
- **Multi-Head Latent Attention (MLA):** Pioneered by DeepSeek, adopted by Kimi. More memory-efficient than grouped query attention.
- **DeepSeek Sparse Attention (DSA):** Reduces attention complexity from O(L^2) to O(L). Adopted by GLM-5.
- **Gated Delta Networks** (Qwen3.5): Combined with sparse MoE for high-throughput inference.
- **Hybrid Mamba-Transformer** (Nemotron 3): Selective state-space models + Transformer attention + MoE.
- **Native INT4 QAT** (Kimi K2.5): Quantization built into training, not applied post-hoc.
- **Non-NVIDIA training:** GLM-5 trained on 100K Huawei Ascend 910B chips using MindSpore.

**Context windows have exploded:**

| Model | Context Length |
|---|---|
| Llama 4 Scout | 10M tokens |
| MiMo-V2-Pro / Nemotron 3 | 1M tokens |
| Kimi K2.5 / Mistral Large 3 | 256K tokens |
| DeepSeek V3.x / Qwen3 / Gemma 3 | 128K tokens |

---

## 2. Training Your Own LLM

### 2.1 Training from Scratch

#### Architecture Choices

| Architecture | Strengths | Weaknesses | Status (2026) |
|---|---|---|---|
| **Transformer (MoE)** | Universal, huge ecosystem, proven at scale | High memory for attention | Dominant at frontier |
| **Transformer (dense)** | Simple, well-understood | Expensive to scale beyond 32B | Standard for smaller models |
| **Mamba / SSM** | O(L) complexity, fast inference, good for long sequences | Less proven at frontier scale | Used in hybrid architectures (Nemotron 3) |
| **RWKV** | Linear complexity, RNN-like efficiency | Smaller community, fewer tools | Niche, v6 available |
| **Hybrid (Mamba+Transformer)** | Best of both: efficient long-context + strong attention | Complex to train | Emerging (Nemotron 3, Jamba) |
| **Gated Delta Net + MoE** | Efficient on-device inference | Very new | Qwen3.5 only |

**Recommendation:** Use standard Transformer (dense or MoE) unless you have a specific need for linear-complexity inference on extremely long sequences.

#### Data Requirements

The Chinchilla scaling law (2022) recommends ~20 tokens per parameter for compute-optimal training. However, modern practice **over-trains** significantly (10-100x Chinchilla) to produce smaller, more capable models:

| Model Size | Chinchilla-Optimal | Modern Practice | Examples |
|---|---|---|---|
| 1B | 20B tokens | 1-3T tokens | Qwen3.5-0.8B (3T+) |
| 3B | 60B tokens | 3-5T tokens | Nemotron 3 Nano |
| 7B | 140B tokens | 2-5T tokens | Qwen3-8B |
| 14B | 280B tokens | 5-10T tokens | Phi-4 (10T tokens) |
| 32B | 640B tokens | 10-15T tokens | Qwen3-32B |
| 70B | 1.4T tokens | 10-15T tokens | Llama 3 (15T tokens) |

**Data quality matters more than quantity.** Models like Phi-4 (14B, MIT license) trained on heavily curated synthetic + web data outperform much larger models on reasoning benchmarks.

#### Hardware Requirements

| Model Size | Cluster Size | Training Time | Cloud Cost (H100) |
|---|---|---|---|
| 1B | 8x H100 | 1-2 weeks | $5K-15K |
| 3B | 16-32x H100 | 2-3 weeks | $20K-50K |
| 7B | 64x A100/H100 | 2-4 weeks | $50K-500K |
| 14B | 128x H100 | 3-6 weeks | $200K-1M |
| 32B | 256x H100 | 4-8 weeks | $500K-2M |
| 70B | 256-512x H100 | 3-8 weeks | $1.2M-6M |
| 200B+ MoE | 2000+ H100 | Months | $5M-50M+ |

**Reference points:**
- DeepSeek V3: 2048 H800 GPUs, 2.788M GPU-hours, ~$5.6M compute cost (exceptionally efficient)
- DeepSeek-R1: ~$294K training cost on H800 GPUs (RL phase only)
- Llama 3.1 405B: 16,384 H100 GPUs for pre-training
- GLM-5: 100,000 Huawei Ascend 910B chips (non-NVIDIA path is viable but requires more hardware)

#### Training Frameworks

| Framework | Best For | Key Features |
|---|---|---|
| **Megatron-LM** (NVIDIA) | Large-scale pre-training | Tensor/pipeline/expert parallelism, battle-tested at 1T+ scale |
| **DeepSpeed** (Microsoft) | Flexible distributed training | ZeRO stages 1-3, offloading, mixed-precision, broad hardware support |
| **PyTorch FSDP** | Native PyTorch integration | Built-in, simpler setup, good for smaller clusters |
| **Nanotron** (HuggingFace) | Research-friendly pre-training | Lightweight, easy to modify, good for experiments |
| **torchtitan** (Meta) | Modern pre-training | Latest PyTorch features, elastic training, 4D parallelism |
| **Mosaic/Databricks** | Managed training | Composer framework, MPT recipes, enterprise support |
| **NeMo** (NVIDIA) | End-to-end pipeline | Pre-training through deployment, Nemotron recipes |

### 2.2 Fine-Tuning (More Practical)

#### Methods Comparison

| Method | Memory (7B) | Memory (70B) | Speed | Quality | When to Use |
|---|---|---|---|---|---|
| **Full Fine-Tuning** | ~70GB VRAM | 320GB+ (multi-GPU) | Slow | Best | Unlimited budget, maximum customization |
| **LoRA** (r=16-64) | ~16GB VRAM | ~80GB (1-2x A100) | Fast | Very good | Most use cases, good quality/cost tradeoff |
| **QLoRA** (4-bit) | ~8GB VRAM | ~40GB (1x A100) | Fast | Good | Budget-constrained, consumer GPUs |
| **DoRA** | ~18GB VRAM | ~90GB | Moderate | Better than LoRA | When LoRA quality is insufficient |
| **Spectrum** | Variable | Variable | Fast | Good | Selective layer fine-tuning |

**LoRA** (Low-Rank Adaptation) adds trainable low-rank matrices to attention layers. Only 0.1-1% of parameters are updated. The `r` (rank) parameter controls capacity: r=8-16 for simple tasks, r=32-64 for complex domain adaptation.

**QLoRA** combines 4-bit quantization of the base model with LoRA adapters, reducing memory by ~75% with only modest quality loss.

#### Business Domain Datasets

| Domain | Public Datasets | Typical Size | Notes |
|---|---|---|---|
| **Financial** | FinGPT data, SEC-EDGAR filings, earnings call transcripts, financial news | 10K-1M documents | FinBloom (50K QA pairs), IDEA-FinBench |
| **Legal** | Pile of Law, CaseText, contract datasets, LegalBench | 50K-500K documents | IBM Data Prep Kit for contract analysis |
| **Medical** | PubMed, MIMIC-III/IV, medical QA | 100K+ papers | Strict compliance requirements |
| **CRM/Sales** | Custom: emails, call transcripts, deal notes | 10K-100K records | Almost always proprietary data |
| **Customer Support** | Custom: ticket history, knowledge base, chat logs | 50K-500K interactions | High ROI for fine-tuning |

**For internal business data:** Generate synthetic instruction-following pairs from your documents using GPT-4/Claude, then fine-tune on those pairs. Typical pipeline: raw docs -> chunk -> generate QA pairs -> filter quality -> format as instruction tuning data.

#### Coding Domain Datasets

| Dataset | Size | Content | Notes |
|---|---|---|---|
| The Stack v2 | 67.5TB | GitHub code, 600+ languages | Largest open code dataset |
| StarCoder training data | 1T+ tokens | GitHub permissive licenses | Used for StarCoder 2 |
| Internal codebase | Varies | Your repos, PRs, reviews, docs | Highest ROI for your specific stack |
| Stack Overflow | 50M+ Q&A pairs | Programming Q&A | Good for instruction tuning |
| Commit message data | Varies | Git history | Good for code understanding |

#### Alignment Methods

| Method | How It Works | Pros | Cons | Status (2026) |
|---|---|---|---|---|
| **RLHF** | Train reward model on human preferences, then PPO | Gold standard, proven | Expensive, complex, unstable training | Still used, but declining |
| **DPO** | Direct optimization on preference pairs, no reward model | Simpler, stable, effective | Can overfit on training distribution | Widely used |
| **SimPO** | Simplified DPO variant | Even simpler, strong results | Newer, less battle-tested | Growing adoption |
| **KTO** | Uses binary (good/bad) signals instead of paired preferences | Works with unpaired data | Lower signal quality | Niche |
| **ORPO** | Combines SFT and alignment in single stage | One-step process | May underperform multi-stage | Research stage |
| **GRPO** | Group relative policy optimization, no critic model | Efficient RL for reasoning | Newer technique | DeepSeek-R1 method |
| **DAPO** | Decoupled clip + dynamic sampling | Stable long-CoT training | Complex to implement | ByteDance/Tsinghua 2025 |
| **RLVR** | RL with verifiable rewards (math, code execution) | Automated verification, scalable | Only works for verifiable tasks | The new paradigm for reasoning |

**Modern post-training stack (2026):**
1. SFT for instruction following
2. DPO/SimPO for alignment and safety
3. GRPO/DAPO + RLVR for reasoning capabilities

#### Fine-Tuning Cost Estimates

| Setup | 7B Model | 14B Model | 70B Model |
|---|---|---|---|
| **1x A100 80GB (cloud, ~$2/hr)** | $50-200 (6-24 hrs, QLoRA) | $100-400 (12-48 hrs, QLoRA) | N/A (insufficient VRAM for full) |
| **1x H100 (cloud, ~$3/hr)** | $30-150 (4-16 hrs, QLoRA) | $75-300 (8-32 hrs, QLoRA) | $200-1000 (24-72 hrs, QLoRA with offloading) |
| **4x A100 80GB (~$8/hr)** | $80-400 (full fine-tune) | $200-800 (LoRA) | $400-2000 (QLoRA) |
| **8x H100 (~$24/hr)** | Not needed | $200-600 (full) | $500-3000 (LoRA) |

**Cloud GPU rental rates (March 2026):**
- H100 SXM: $1.38-3.50/GPU-hr (median $2.29)
- A100 80GB: $1.00-2.50/GPU-hr
- RTX 4090: $0.40-0.75/GPU-hr

#### Fine-Tuning Tools

| Tool | Best For | Key Features | Learning Curve |
|---|---|---|---|
| **Unsloth** | Fast LoRA/QLoRA | 2-5x faster than HuggingFace, 70% less memory, free tier | Low |
| **Axolotl** | Flexible fine-tuning | YAML config, supports all methods, multi-GPU | Medium |
| **LLaMA-Factory** | UI-based fine-tuning | Web UI, 100+ models, all methods | Low |
| **TRL** (HuggingFace) | RLHF/DPO/PPO | Official HF library, well-documented, SFTTrainer | Medium |
| **torchtune** (Meta) | PyTorch-native | Clean codebase, Llama-focused, composable | Medium |
| **OpenRLHF** | Distributed RLHF | Ray-based, scales to large clusters | High |

**Unsloth** specifically provides: 2x faster training, 70% less memory usage, support for QLoRA with 4-bit quantization, and a free tier. It achieves this through custom CUDA kernels and optimized backpropagation. The best starting point for most fine-tuning projects.

### 2.3 Distillation

#### Teacher-Student Distillation

Use a frontier model (GPT-4, Claude Opus, DeepSeek V3.2) to generate high-quality training data, then fine-tune a smaller model on that data.

**Pipeline:**
1. Curate a set of prompts relevant to your domain (1K-100K prompts)
2. Generate responses from the teacher model (GPT-4/Claude)
3. Filter for quality using a judge model or heuristics
4. Fine-tune the student model (7B-14B) on the filtered (prompt, response) pairs
5. Evaluate on held-out benchmarks

**Real example — DeepSeek-R1 distillation results:**
- DeepSeek-R1-Distill-Qwen-32B outperforms OpenAI o1-mini on math benchmarks
- DeepSeek-R1-Distill-Qwen-8B demonstrates strong reasoning at just 8B parameters
- Distilled models available at 1.5B, 7B, 8B, 14B, 32B, and 70B sizes

#### Synthetic Data Generation

| Approach | Quality | Cost | Scale |
|---|---|---|---|
| Direct generation (prompt -> response) | Good | $0.50-5 per 1K samples | 10K-1M samples |
| Seed + evolution (WizardLM-style) | Very good | $2-10 per 1K samples | 10K-100K samples |
| Self-play / debate | Excellent | $5-20 per 1K samples | 1K-50K samples |
| Backtranslation (response -> prompt -> response) | Good for diversity | $1-5 per 1K samples | 10K-500K samples |

#### Quality Evaluation

| Benchmark | What It Measures | Status (2026) |
|---|---|---|
| **HumanEval** | Python code generation (164 problems) | Saturated (>90% for frontier models) |
| **SWE-bench Verified** | Real GitHub issue resolution | Current gold standard for coding |
| **MMLU / MMLU-Pro** | Multitask knowledge (57/harder subjects) | MMLU saturated; MMLU-Pro still useful |
| **MT-Bench** | Multi-turn conversation (LLM-as-judge) | Still useful for chat models |
| **AlpacaEval 2** | Instruction following (LLM preference) | Good for alignment quality |
| **Chatbot Arena** | Human preference (Elo ranking) | Best overall quality signal |
| **GPQA Diamond** | PhD-level science questions | Hard enough to differentiate frontier models |
| **AIME 2025** | Math competition problems | Key reasoning benchmark |
| **LiveCodeBench** | Continuously updated coding problems | Avoids contamination |

#### Legal/ToS Considerations

- OpenAI, Anthropic, and Google ToS **prohibit** using their API outputs to train competing models
- However, distillation for **internal business use** (not redistribution) generally has more flexibility
- Open-weight models (DeepSeek, Qwen, Llama with restrictions, Mistral) allow distillation
- **Safest approach:** Use open-weight teacher models (DeepSeek V3.2, Qwen3, Mistral) for distillation

---

## 3. Inference & Deployment

### 3.1 Inference Engines Comparison

| Engine | Throughput (H100, tok/s) | Best For | License |
|---|---|---|---|
| **TensorRT-LLM** | ~18,000+ (compiled) | Max throughput, single model in production | NVIDIA proprietary |
| **SGLang** | ~16,200 | Shared prefix workloads (chatbots, RAG) | Apache 2.0 |
| **vLLM** | ~12,500 | Production flexibility, model swapping | Apache 2.0 |
| **ExLlamaV2** | ~14,000 (consumer GPU) | Consumer GPU speed, EXL2 format | MIT |
| **llama.cpp** | ~7,500-9,000 | Local/edge, CPU+GPU hybrid, GGUF | MIT |
| **Ollama** | Wraps llama.cpp | Developer experience, one-command setup | MIT |
| **TGI** | Varies | Legacy HuggingFace deployments (maintenance mode) | Apache 2.0 |

**Detailed notes:**

- **vLLM:** PagedAttention reduces KV cache waste from 60-80% to <4%. Continuous batching, FlashAttention-3 on H100, multi-LoRA batching, FP8 support. OpenAI-compatible API. The "safe default" for production.
- **SGLang:** RadixAttention for automatic prefix caching. 29% faster than vLLM in throughput. Best for multi-turn conversations and RAG pipelines with shared system prompts.
- **TensorRT-LLM:** Requires model compilation (hours), but 8-50% faster than alternatives once compiled. p95 TTFT is 1,280ms vs vLLM's 1,450ms at 100 concurrent requests. Best for long-term single-model deployment.
- **llama.cpp:** GGUF format bundles everything in one file. RTX 4090: ~96 tok/s at 32K context. Kernel fusion (2026) cuts eval time 40% vs vLLM on some models. Speculative decoding achieves 2-3x throughput.
- **Ollama:** 100+ models available. OpenAI-compatible API. `ollama run llama3.3:70b` and you're running. Best for getting started.
- **ExLlamaV2:** 147% faster than bitsandbytes, 85% faster than llama.cpp in some benchmarks. EXL2 format allows per-layer mixed precision (2-8 bits).

### 3.2 Quantization Guide

| Method | Bits | Quality Impact | Speed Impact | Best For |
|---|---|---|---|---|
| **FP8** | 8 | <0.5% accuracy loss | 2x throughput vs FP16 | Datacenter H100/MI300X (native hardware support) |
| **AWQ + Marlin** | 4 | ~0.7% perplexity drop | 741 tok/s (best speed-quality) | Production on NVIDIA GPUs |
| **GPTQ + Marlin** | 4 | ~2.8% perplexity increase | Good with Marlin kernels | Production on NVIDIA GPUs |
| **GGUF Q4_K_M** | 4.5 | ~8% quality reduction | ~100 tok/s (RTX 4090) | Local inference, Apple Silicon, CPU |
| **GGUF Q6_K** | 6.5 | ~1-2% quality reduction | Slower than Q4 | Quality-focused local inference |
| **GGUF Q8_0** | 8 | <1% quality loss | Slowest GGUF | Near-lossless local |
| **EXL2** | 2-8 (mixed) | Configurable per-layer | 147% faster than bitsandbytes | Consumer GPU speed |
| **AQLM** | 2 | Best at extreme compression | Good | Extreme compression for MoE models |
| **QTIP** | 2-4 | Best overall at low bits | Good | Cutting-edge low-bit quantization |
| **HQQ** | 4 | Good, no calibration needed | 50x faster quantization | Quick quantization without calibration data |

**Decision tree:**
1. Datacenter with H100/MI300X? -> **FP8**
2. NVIDIA GPU, production quality? -> **AWQ + Marlin kernel**
3. Local Mac/CPU? -> **GGUF Q4_K_M** (balanced) or **Q6_K** (quality)
4. Consumer NVIDIA GPU, max speed? -> **EXL2** or **Marlin-AWQ**
5. Extreme compression (2-bit)? -> **AQLM with PV-Tuning** or **QTIP**

### 3.3 Performance Optimization Techniques

#### Speculative Decoding
A small "draft" model generates candidate tokens; the large model verifies them in one forward pass.
- Practical speedup: **2-3x** at low concurrency
- Code completion: 0.75-0.85 acceptance rate (highly predictable)
- Below 0.5 acceptance rate, it hurts performance
- Implementations: EAGLE-3, P-EAGLE (1.05-1.69x over EAGLE-3), DART (3.44x wall-clock)
- Built into vLLM, SGLang, TensorRT-LLM

#### Flash Attention
- **Flash Attention 2:** 2-4x faster than standard attention (A100, RTX 4090)
- **Flash Attention 3:** Up to 2x faster than FA2 on H100, reaching 740 TFLOPS (75% of theoretical max), FP8 support
- **FlashInfer:** Up to 31x speedup for shared-prefix batch decoding

#### KV Cache Optimization
- **PagedAttention:** <4% waste vs 60-80% traditional
- **FP8 KV cache:** Halves memory, enables 2x longer contexts
- Combined with PagedAttention: 2x context length at same memory budget

#### Prefix Caching
- Reuses KV cache across requests sharing common prefixes (system prompts, RAG context)
- vLLM: zero-overhead automatic prefix caching
- SGLang: RadixAttention (trie-based prefix tree)
- Anthropic prompt caching: saves up to 90% on cached tokens

### 3.4 Hardware for Inference

#### Apple Silicon (Best for Local Development)

| Chip | Max Memory | Bandwidth | 70B Q4 Performance | Price |
|---|---|---|---|---|
| M4 Pro | 48 GB | 273 GB/s | Too small for 70B | ~$2,500 |
| M4 Max | 128 GB | 546 GB/s | ~7-10 tok/s | ~$4,000 |
| **M4 Ultra** | **192 GB** | **819 GB/s** | **20-30 tok/s** | **~$7,000** |
| M3 Ultra | 192 GB | 800 GB/s | ~15-25 tok/s | ~$7,000 |

**Key advantage:** 192GB unified memory runs a 70B model entirely in-memory without offloading. No consumer GPU can match this. ~50W total system power for 70B inference. M4 Max at 128GB: up to 525 tok/s on 8B models.

#### NVIDIA GPUs

| GPU | VRAM | Bandwidth | ~7B tok/s | ~70B tok/s | Purchase Price | Cloud $/hr |
|---|---|---|---|---|---|---|
| RTX 4090 | 24 GB | 1,008 GB/s | ~96 | N/A | ~$1,600 | $0.40-0.75 |
| A100 80GB | 80 GB | 2,039 GB/s | ~130 | ~20-30 | ~$15,000 | $1.50-2.50 |
| **H100 SXM** | **80 GB** | **3,350 GB/s** | **~250-300** | **~40-60** | **$25K-40K** | **$2.85-3.50** |
| H200 | 141 GB | 4,800 GB/s | ~350+ | ~60-80 | ~$35K-45K | $3.50-5.00 |

**8x H100 DGX server:** $250K-450K purchase. Cloud rental: $22-28/hr. Required for 400B+ models.

#### AMD MI300X

| Spec | MI300X | H100 SXM |
|---|---|---|
| VRAM | **192 GB HBM3** | 80 GB HBM3 |
| Bandwidth | **5,300 GB/s** | 3,350 GB/s |
| FP16 TFLOPS | **1,307** | 989 |
| Llama2-70B latency | **40% lower** | Baseline |
| Cost per M tokens (bs=1) | **$22.22** | $28.11 |

MI300X nearly doubles throughput over H100 for memory-bound workloads due to 2.4x VRAM and 58% higher bandwidth. Software ecosystem (ROCm) still lags CUDA but usable with vLLM and llama.cpp.

#### CPU Inference
- Intel Xeon 6 with AMX: 5-50 tok/s depending on model size
- AMD EPYC 9755: competitive with Xeon
- Best for: models that don't fit in GPU VRAM, cost-sensitive batch processing

### 3.5 Cost Per Token: Local vs Cloud

#### Cloud API Pricing (March 2026)

| Provider / Model | Input $/M | Output $/M |
|---|---|---|
| OpenAI GPT-5.2 | $1.75 | $14.00 |
| OpenAI GPT-5 mini | $0.25 | $2.00 |
| Anthropic Claude Opus 4.6 | $5.00 | $25.00 |
| Anthropic Claude Sonnet 4 | $3.00 | $15.00 |
| Anthropic Claude Haiku | $1.00 | $5.00 |
| DeepSeek V3.2 (API) | ~$0.07 | ~$0.28 |
| Together/Fireworks (open models) | $0.05-0.90 | $0.05-0.90 |
| Groq (small models) | ~$0.11 | ~$0.11 |

#### Self-Hosted Cost

| Utilization | Cost per M Tokens (H100 @ $3/hr, 70B) |
|---|---|
| 20% | ~$2.00 |
| 50% | ~$0.80 |
| 80%+ | ~$0.20 |

#### Break-Even Analysis

- On-premises H100 breaks even vs cloud APIs **in as little as 4 months** at >20% utilization (down from 12-18 months in 2024)
- **7B model:** Needs ~50% utilization to beat GPT-3.5 Turbo pricing
- **13B model:** Cost parity with GPT-4-turbo at only 10% utilization
- **70B model:** Almost always cheaper self-hosted with consistent volume
- **Rule of thumb:** 10+ million tokens daily makes self-hosting viable
- 5-year lifecycle savings: **$5M+** per 8xH100 server vs cloud hourly rates

---

## 4. RAG Architecture for Business

### 4.1 Vector Databases

| Database | QPS (50M vec) | p99 Latency | Hybrid Search | Self-hosted | Best For |
|---|---|---|---|---|---|
| **pgvector/scale** | 471.57 | 74.60ms | Via SQL | Yes (PG ext) | Teams already on PostgreSQL |
| **Qdrant** | 41.47 | 38.71ms | Yes (v1.9+) | Yes (Apache 2.0) | Complex metadata filtering |
| **Milvus 2.5** | High (6ms @ 1M) | Low | Yes (Sparse-BM25) | Yes (Apache 2.0) | Large-scale unified search |
| **Weaviate** | Moderate | Moderate | Yes (BlockMax WAND) | Yes | Knowledge graph + vectors |
| **Pinecone** | High (managed) | Low | Yes (proprietary) | No | Zero ops, enterprise compliance |
| **LanceDB** | ~15ms (5M) | Low | Yes | Yes (Apache 2.0) | Embedded, zero-infrastructure |
| **Chroma** | Moderate | Low | Basic | Yes | Prototyping, small datasets |

**Key findings:**
- pgvectorscale delivers 11.4x more throughput than Qdrant at 50M vectors but with worse tail latency
- Milvus 2.5 hybrid search processes queries 30x faster than Elasticsearch
- LanceDB reached 1.5M IOPS in January 2026 storage benchmarks

**Recommendation:** Start with pgvector if you already use PostgreSQL. Move to Qdrant or Milvus for dedicated vector workloads at scale.

### 4.2 Embedding Models

#### Top Open-Source Models (MTEB, March 2026)

| Model | MTEB Score | Dimensions | Parameters | Key Feature |
|---|---|---|---|---|
| **Qwen3-Embedding-8B** | 70.58 (multilingual) | 32-7168 (Matryoshka) | 8B | #1 multilingual, 100+ languages, Apache 2.0 |
| **BGE-en-ICL** | 71.24 (English) | 4096 | ~7B | In-context learning for task boosting |
| **Nomic Embed v2** | Competitive | 768 | 475M (305M active) | MoE, 8192 tokens, Apache 2.0, runs on modest GPUs |
| **BGE-M3** | Strong | 1024 | 568M | Dense + sparse + ColBERT in one model |
| **Jina Embeddings v4** | 55.97 (en) | 2048 | 3.8B | Multimodal (text+image), 3 LoRA adapters |
| **E5-Mistral-7B-instruct** | ~66.6 (English) | 4096 | 7B | Instruction-tuned, strong zero-shot |

**Practical guidance:**
- Cost-sensitive self-hosting: **Nomic Embed v2** (475M params, runs on CPU)
- Maximum quality: **Qwen3-Embedding-8B** or **BGE-en-ICL**
- Multimodal (text + images): **Jina Embeddings v4**
- OpenAI text-embedding-3-large is outperformed by multiple open-source models now

### 4.3 Chunking Strategies

| Strategy | When to Use | Chunk Size | Quality Impact |
|---|---|---|---|
| **Fixed-size** | Simple use cases | 256-512 tokens, 10-20% overlap | Baseline |
| **Recursive character** | General purpose (LangChain default) | 256-512 tokens | Good balance |
| **Document-aware** | Technical docs, legal, structured content | Follows headers/sections | Better for structured docs |
| **Semantic chunking** | When boundary quality matters | Variable | +9% recall vs fixed-size |
| **Late chunking** | Long-context embedding models available | Variable | Retains full document context |
| **Contextual retrieval** (Anthropic) | Maximum retrieval quality | Any | **-67% retrieval failure** (with reranking) |

**Highest-impact technique:** Anthropic's contextual retrieval prepends LLM-generated context to each chunk before embedding. Cost: ~$1.02 per million tokens with prompt caching. Results: 35% failure reduction (embeddings alone), 49% (+ BM25), 67% (+ reranking).

### 4.4 Reranking

| Reranker | Parameters | Latency | Quality | Cost |
|---|---|---|---|---|
| **BGE-reranker-v2-m3** | 278M | 50-100ms (GPU) | Strong, consistent | Self-hosted |
| **ColBERTv2 + PLAID** | ~110M | 7x faster (GPU), 45x (CPU) | 30-50% better recall than bi-encoders | Self-hosted |
| **Cohere Rerank 3.5** | Proprietary | ~600ms (API) | Competitive but spiky across domains | API pricing |
| **ColPali** | -- | -- | Multimodal document retrieval | Self-hosted |

Reranking adds 15-25% relative improvement to retrieval precision on top of good first-stage retrieval.

### 4.5 Hybrid Search: Semantic + Keyword

Combining dense vector search with BM25 keyword search:
- Recall increases from ~0.72 (BM25 alone) to ~0.91 (hybrid)
- Precision increases from ~0.68 to ~0.87
- **15-30% better recall** than either method alone
- Fusion: Reciprocal Rank Fusion (RRF) is robust out-of-the-box
- Supported by: Milvus 2.5, Weaviate, Qdrant v1.9+, Pinecone, LanceDB

### 4.6 Advanced RAG Techniques

| Technique | What It Does | Impact | Cost |
|---|---|---|---|
| **Graph RAG** (Microsoft) | Builds knowledge graph from docs, community summaries | 3.4x better accuracy (80% vs 50%) | 10-40x more expensive than vector indexing |
| **Agentic RAG** | LLM loops: decompose, retrieve, self-correct | Handles multi-hop queries | Higher latency, more tokens |
| **Self-RAG** | LLM generates reflection tokens for retrieval decisions | Better grounding | Requires special training |
| **CRAG** | Lightweight evaluator (0.77B) assesses retrieval quality | +26.7pp accuracy on correct retrievals | Minimal overhead |
| **RAPTOR** | Recursive tree of summaries at multiple abstraction levels | +20% accuracy on long documents | Indexing time |
| **Contextual Retrieval** | Prepend context to chunks before embedding | -67% retrieval failures | ~$1/M tokens |

### 4.7 Multi-Modal RAG

**ColPali/ColQwen** treat each document page as an image:
- Divides pages into patches (32x32 = 1024 patches/page)
- Embeds patches preserving spatial layout
- No OCR or text extraction needed
- Captures tables, charts, figures that text-only approaches miss

### 4.8 RAG Evaluation (RAGAS Framework)

| Metric | What It Measures | Target |
|---|---|---|
| **Faithfulness** | Is the answer grounded in context? | >0.8 |
| **Answer Relevancy** | Does the answer address the question? | >0.8 |
| **Context Precision** | Are retrieved docs relevant and well-ranked? | >0.8 |
| **Context Recall** | Were all necessary docs retrieved? | >0.8 |

**Common failure modes:**
1. Related-but-wrong content: Fix with better chunking, metadata filtering, hybrid search
2. Lost in the middle: Reduce chunk count, use reranking
3. Stale chunks: Timestamp-based boosting, regular re-indexing
4. Semantic drift: Late chunking, contextual retrieval

---

## 5. Recommended Stack for Integration

### Phase 1: Cloud LLMs + Smart Routing (Month 1-3)

**Architecture:** API gateway that routes requests to the best model based on complexity.

```
User Request -> Complexity Classifier -> Route:
  - Simple (FAQ, formatting): Claude Haiku ($1/$5 per M tokens)
  - Medium (analysis, coding): Claude Sonnet ($3/$15 per M tokens)
  - Complex (reasoning, architecture): Claude Opus ($5/$25 per M tokens)
```

**Cost optimization:** Use prompt caching (90% savings on repeated prefixes), batch API for non-realtime tasks (50% discount), and smart routing to minimize Opus usage.

**Estimated cost:** $0.50-5.00 per 1K user interactions depending on complexity mix.

### Phase 2: Ollama Local + Cloud Fallback (Month 3-6)

**Architecture:** Local Ollama instance handles simple tasks; cloud APIs handle complex ones.

| Task | Local Model | Cloud Fallback |
|---|---|---|
| Code completion | Qwen3-14B (GGUF Q4_K_M) | Claude Sonnet |
| Text summarization | Qwen3-8B | Claude Haiku |
| Complex reasoning | -- | Claude Opus |
| Data extraction | Qwen3-14B | Claude Sonnet |

**Hardware:** Mac Studio M4 Ultra (192GB) or 1x RTX 4090 (24GB for 7-14B models).
**Cost:** ~$7,000 one-time hardware + reduced API spend (50-70% reduction on simple tasks).

### Phase 3: Fine-Tuned Models (Month 6-12)

| Use Case | Base Model | Fine-Tuning Approach | Expected Performance |
|---|---|---|---|
| Business domain | Qwen3-14B | QLoRA on domain data (10K-50K examples) | 80-90% of Claude Sonnet on domain tasks |
| Coding assistant | DeepSeek-Coder-V2 or Qwen3-Coder-8B | QLoRA on internal codebase | Strong on your specific stack |
| Customer support | Qwen3-8B | LoRA on ticket/chat history | 90%+ accuracy on routine queries |

**Cost:** $500-2,000 per fine-tuning run on cloud GPUs.

### Phase 4: Custom Model on Customer Data (Month 12-18)

Train a specialized 5-15B model using:
1. Distillation from Claude/GPT-4 on your domain (50K-200K examples)
2. Fine-tuning on proprietary customer data
3. DPO alignment on human preferences from your platform
4. RLVR on verifiable business outcomes (correct answers, successful resolutions)

**Result:** A model that knows your domain deeply, runs locally, and costs near-zero per inference.

### Phase 5: Edge Deployment (Month 18-24)

Deploy quantized models to customer hardware:
- **GGUF Q4_K_M** for Apple Silicon (M-series Macs)
- **AWQ/EXL2** for NVIDIA GPUs
- **ONNX Runtime** for CPU-only environments
- Models served via Ollama or a custom inference server

---

## 6. Build vs Buy Analysis

### Decision Framework

| Criterion | Use Cloud APIs | Fine-Tune Open Model | Train from Scratch |
|---|---|---|---|
| **Volume** | <10M tokens/day | 10-100M tokens/day | >100M tokens/day |
| **Domain specificity** | General tasks | Moderate specialization | Deep domain expertise needed |
| **Data sensitivity** | Non-sensitive | Sensitive (can self-host) | Highly regulated |
| **Budget** | $100-10K/month | $10K-50K one-time + hosting | $500K-5M+ |
| **Team ML expertise** | None needed | Some ML experience | Dedicated ML team |
| **Time to value** | Days | Weeks | Months to years |
| **Maintenance** | Zero (provider handles) | Model updates, data pipeline | Full training infrastructure |

### Cost Crossover Analysis

#### API vs Self-Hosted Inference

| Monthly Volume | Cloud API Cost (avg $2/M tok) | Self-Hosted Cost (70B on H100) | Winner |
|---|---|---|---|
| 1M tokens/day | ~$60/month | ~$2,200/month (cloud H100) | **Cloud API** |
| 10M tokens/day | ~$600/month | ~$2,200/month | **Self-hosted** (3.7x cheaper) |
| 50M tokens/day | ~$3,000/month | ~$2,200/month | **Self-hosted** (1.4x cheaper) |
| 100M tokens/day | ~$6,000/month | ~$2,200/month | **Self-hosted** (2.7x cheaper) |
| 1B tokens/day | ~$60,000/month | ~$2,200/month | **Self-hosted** (27x cheaper) |

Note: Self-hosted costs assume a single H100 at $3/hr cloud rental running 24/7. Purchased hardware amortized over 3 years would be even cheaper.

#### Fine-Tuning vs From-Scratch Training

| Approach | Cost | Time | When to Choose |
|---|---|---|---|
| **QLoRA fine-tune** (7B) | $50-500 | Hours | Default starting point |
| **LoRA fine-tune** (14B) | $200-2,000 | 1-3 days | Need higher quality |
| **Full fine-tune** (7B) | $1,000-5,000 | 1-2 weeks | Maximum customization |
| **Continued pre-training** (7B) | $10,000-50,000 | 2-4 weeks | Large domain corpus |
| **Train from scratch** (7B) | $50,000-500,000 | 1-2 months | Unique architecture/data needs |
| **Train from scratch** (70B) | $1.2M-6M | 2-3 months | Only if you're a well-funded AI lab |

### Compliance Benefits of Local Deployment

| Requirement | Cloud APIs | Self-Hosted |
|---|---|---|
| **GDPR data residency** | Depends on provider region | Full control |
| **HIPAA compliance** | BAA required, limited providers | Full control |
| **Data sovereignty** | Data crosses borders | Stays on-premises |
| **Audit trail** | Provider-dependent | Complete control |
| **No data sharing** | Provider may use for training | Guaranteed isolation |
| **Air-gapped deployment** | Impossible | Fully supported |

---

## 7. Practical Roadmap

### Month 1-3: Foundation

**Goals:** Ollama integration, model routing, baseline evaluation.

| Task | Details | Deliverable |
|---|---|---|
| Set up Ollama | Install on development machines, test with Qwen3-14B and DeepSeek V3 | Working local inference |
| Build routing layer | Complexity classifier (simple regex + embedding similarity) | API gateway that routes simple->local, complex->cloud |
| Evaluate baseline | Benchmark cloud vs local on your actual workloads | Performance comparison report |
| RAG prototype | pgvector + Nomic Embed v2 + basic chunking | Search over your knowledge base |

**Hardware:** Mac Studio M4 Ultra ($7K) or 1x RTX 4090 workstation ($3K).
**Budget:** ~$10K hardware + ~$500/month cloud API for complex tasks.

### Month 3-6: Fine-Tuned Coding Model

**Goals:** QLoRA fine-tune on your codebase, deploy for code completion.

| Task | Details | Deliverable |
|---|---|---|
| Prepare coding dataset | Extract from internal repos: function docstrings, PR descriptions, code review comments | 10K-50K instruction pairs |
| Fine-tune coding model | QLoRA on Qwen3-Coder-8B or DeepSeek-Coder using Unsloth | Custom coding model |
| Evaluate | Test on internal coding tasks, compare with cloud models | Benchmark results |
| Deploy | Serve via vLLM or Ollama with LoRA adapter | Production coding assistant |

**Cost:** $200-1,000 for fine-tuning compute. 1-2 weeks of ML engineer time.
**Expected result:** 70-85% of Claude Sonnet quality on your specific codebase.

### Month 6-12: Fine-Tuned Business Model

**Goals:** Domain-specific model for business tasks (emails, reports, CRM).

| Task | Details | Deliverable |
|---|---|---|
| Curate business dataset | Extract from CRM, emails, reports, support tickets | 20K-100K examples |
| Generate synthetic data | Use Claude/GPT-4 to generate instruction pairs from business docs | Additional 50K examples |
| Fine-tune business model | QLoRA on Qwen3-14B using Axolotl | Custom business model |
| DPO alignment | Collect human preferences on model outputs | Aligned model |
| Hybrid RAG | Upgrade to hybrid search (semantic + BM25), add reranking | Production RAG pipeline |

**Cost:** $1,000-5,000 for compute. 4-8 weeks of ML engineer time.
**Expected result:** 80-90% of Claude Sonnet on your business domain.

### Month 12-18: Distillation Pipeline

**Goals:** Systematic distillation from frontier models to create high-quality training data.

| Task | Details | Deliverable |
|---|---|---|
| Build distillation pipeline | Automated: prompt generation -> teacher inference -> quality filtering -> training | Reusable pipeline |
| Continuous data generation | Generate 10K-50K new examples monthly from production queries | Growing training dataset |
| Teacher ensemble | Use DeepSeek V3.2 + Qwen3 as open-weight teachers (avoid ToS issues) | Diverse training signal |
| Iterative improvement | Monthly re-fine-tuning with accumulated data | Improving model quality |

**Cost:** $500-2,000/month for teacher model inference + fine-tuning compute.

### Month 18-24: Small Custom Model

**Goals:** Train a domain-specific 3-7B model from a strong foundation.

| Task | Details | Deliverable |
|---|---|---|
| Continued pre-training | Take Qwen3-4B or Phi-4, continue pre-training on your domain corpus (100B+ tokens) | Domain-adapted base model |
| Instruction tuning | SFT on accumulated instruction dataset (200K+ examples) | Instruction-following model |
| Alignment | DPO on human preferences + RLVR on verifiable business outcomes | Aligned and capable model |
| Edge optimization | Quantize to GGUF Q4_K_M, benchmark on customer hardware | Deployable edge model |

**Cost:** $10,000-50,000 for compute. Dedicated ML engineer.
**Expected result:** A 3-7B model that outperforms generic 14B models on your specific domain.

### Month 24-36: Full Custom Model with RLHF

**Goals:** Purpose-built model with custom architecture choices.

| Task | Details | Deliverable |
|---|---|---|
| Architecture selection | Dense 5B vs MoE 15B-total/3B-active based on deployment constraints | Architecture design |
| Pre-training | Train on curated mix: domain data + general capability data (1-5T tokens) | Base model |
| Multi-stage post-training | SFT -> DPO -> GRPO/RLVR | Fully trained model |
| Red-teaming | Adversarial testing, safety evaluation, bias audit | Safety report |
| Production deployment | Multi-region, A/B testing, monitoring, fallback to cloud | Production system |

**Cost:** $50,000-500,000+ for compute. ML team of 2-5 people.
**Expected result:** A model purpose-built for your use case that runs anywhere.

---

## References

### Papers
- [Attention Is All You Need](https://arxiv.org/abs/1706.03762) -- Original Transformer
- [LoRA: Low-Rank Adaptation](https://arxiv.org/abs/2106.09685) -- Foundation of efficient fine-tuning
- [QLoRA](https://arxiv.org/abs/2305.14314) -- 4-bit fine-tuning
- [DPO: Direct Preference Optimization](https://arxiv.org/abs/2305.18290) -- Simpler alignment
- [DeepSeek-R1 Technical Report](https://arxiv.org/abs/2501.12948) -- RL for reasoning
- [DeepSeek V3 Technical Report](https://arxiv.org/abs/2412.19437) -- MoE architecture
- [RAPTOR](https://arxiv.org/abs/2401.18059) -- Recursive abstractive retrieval
- [CRAG](https://arxiv.org/abs/2401.15884) -- Corrective retrieval
- [ColBERTv2](https://arxiv.org/abs/2205.09707) -- Late interaction retrieval
- [FlashAttention-2](https://arxiv.org/abs/2307.08691) -- Fast attention
- [Chinchilla Scaling Laws](https://arxiv.org/abs/2203.15556) -- Data-optimal training
- [DAPO](https://arxiv.org/abs/2503.14476) -- Decoupled policy optimization for long CoT

### Tools and Frameworks
- [vLLM](https://github.com/vllm-project/vllm) -- Production inference engine
- [SGLang](https://github.com/sgl-project/sglang) -- Fast inference with RadixAttention
- [llama.cpp](https://github.com/ggml-org/llama.cpp) -- Local inference, GGUF format
- [Ollama](https://github.com/ollama/ollama) -- User-friendly local LLM runtime
- [ExLlamaV2](https://github.com/turboderp-org/exllamav2) -- Fast consumer GPU inference
- [Unsloth](https://github.com/unslothai/unsloth) -- Fast LoRA/QLoRA fine-tuning
- [Axolotl](https://github.com/axolotl-ai-cloud/axolotl) -- Flexible fine-tuning framework
- [LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory) -- UI-based fine-tuning
- [TRL](https://github.com/huggingface/trl) -- HuggingFace RL for language models
- [torchtune](https://github.com/pytorch/torchtune) -- PyTorch-native fine-tuning
- [RAGAS](https://github.com/explodinggradients/ragas) -- RAG evaluation framework
- [Qdrant](https://github.com/qdrant/qdrant) -- Vector database
- [Milvus](https://github.com/milvus-io/milvus) -- Scalable vector database
- [LanceDB](https://github.com/lancedb/lancedb) -- Embedded vector database

### Model Hubs
- [HuggingFace Models](https://huggingface.co/models) -- Largest model repository
- [Ollama Library](https://ollama.com/library) -- Pre-quantized models for Ollama
- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) -- Embedding model rankings
- [Open LLM Leaderboard](https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard) -- Model benchmarks
- [Chatbot Arena](https://lmarena.ai/) -- Human preference rankings

### Cloud GPU Providers
- [Lambda](https://lambda.ai/) -- H100 cloud, on-demand and reserved
- [RunPod](https://www.runpod.io/) -- Flexible GPU cloud
- [Together AI](https://www.together.ai/) -- Inference + fine-tuning API
- [Fireworks AI](https://fireworks.ai/) -- Fast inference API
- [Groq](https://groq.com/) -- Ultra-fast inference on custom LPU hardware

---

*Last updated: March 2026. The LLM landscape moves fast -- verify specific benchmarks and pricing before making decisions.*
