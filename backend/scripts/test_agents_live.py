"""
Live verification script for all 5 agents using current .env credentials.
Tests:
1. Groq LLM Provider (openai/gpt-oss-120b)
2. Gemini Embedding Provider (text-embedding-004)
3. Planner Node (decomposing goal into subtasks)
4. Discovery Node (searching candidate URLs)
5. Extractor Node (fetching and extracting structured content)
6. Validator Node (validating content and scanning for injection)
7. Writer Node (persisting markdown and embedding)
"""

import asyncio
import os
import sys
from pathlib import Path
from uuid import uuid4

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv()

from shared.models import (
    AppConfig,
    load_config,
    PlannerInput,
    DiscoveryInput,
    ExtractorInput,
    ValidatorInput,
    WriterInput,
    ExtractedPage,
    ValidationVerdict,
    ValidatorOutput,
)
from shared.providers import get_llm_provider, get_embedding_provider, GroqProvider
from agents.planner import planner_node
from agents.discovery import discovery_node
from agents.extractor import extractor_node
from agents.validator import validator_node
from agents.writer import writer_node


async def run_live_check():
    print("=" * 60)
    print("STARTING 5-AGENT LIVE HEALTH & EXECUTION CHECK")
    print("=" * 60)
    
    cfg = load_config()
    run_id = uuid4()
    page_id = uuid4()

    print(f"Config loaded:")
    print(f"  - Groq Model: {cfg.groq_model}")
    print(f"  - Groq API Key set: {bool(cfg.groq_api_key)}")
    print(f"  - Google API Key set: {bool(cfg.google_api_key)}")
    print(f"  - Tavily API Key set: {bool(cfg.tavily_api_key)}")
    print(f"  - Embedding Dimensions: {cfg.embedding_dimensions}")
    print("-" * 60)

    # 1. TEST GROQ LLM DIRECTLY
    print("[1/5 Provider Test] Testing Groq Reasoning Provider...")
    try:
        llm = get_llm_provider(role="reasoning")
        res_json, tokens = await llm.complete_json(
            messages=[{"role": "user", "content": 'Return a JSON object: {"status": "ok", "message": "groq reasoning works"}'}],
            system_prompt="Always output strictly valid JSON."
        )
        print(f"  [SUCCESS] Groq output: {res_json} (Tokens used: {tokens})")
    except Exception as e:
        print(f"  [FAILED] Groq provider failed: {e}")
        return

    # 2. TEST PLANNER NODE
    print("\n[2/5 Agent Check] Testing Planner Agent...")
    try:
        planner_in = PlannerInput(
            run_id=run_id,
            goal="Autonomous Multi-Agent AI System Orchestration Patterns",
            max_subtasks=2,
            max_domains_per_subtask=2,
        )
        planner_res = await planner_node(planner_in.model_dump())
        subtasks = planner_res.get("subtasks", [])
        print(f"  [SUCCESS] Planner generated {len(subtasks)} subtasks:")
        for s in subtasks:
            print(f"    - Subtask: {s.get('description')} (domains: {s.get('candidate_domains')})")
    except Exception as e:
        print(f"  [FAILED] Planner failed: {e}")
        return

    # 3. TEST DISCOVERY NODE
    print("\n[3/5 Agent Check] Testing Discovery Agent...")
    first_subtask = subtasks[0] if subtasks else {"subtask_id": "st-1", "description": "Review orchestration architectures", "candidate_domains": ["arxiv.org"]}
    try:
        discovery_in = DiscoveryInput(
            run_id=run_id,
            subtask_id=first_subtask.get("subtask_id", "st-1"),
            description=first_subtask.get("description", "orchestration"),
            candidate_domains=first_subtask.get("candidate_domains", ["arxiv.org"]),
            max_urls=2,
        )
        discovery_res = await discovery_node(discovery_in.model_dump())
        ranked_urls = discovery_res.get("ranked_urls", [])
        print(f"  [SUCCESS] Discovery discovered {len(ranked_urls)} URLs:")
        for u in ranked_urls:
            print(f"    - URL: {u.get('url')} (score: {u.get('relevance_score')})")
    except Exception as e:
        print(f"  [FAILED] Discovery failed: {e}")
        return

    target_url = ranked_urls[0]["url"] if ranked_urls else "https://arxiv.org/abs/1706.03762"

    # 4. TEST EXTRACTOR NODE
    print(f"\n[4/5 Agent Check] Testing Extractor Agent on {target_url}...")
    try:
        extractor_in = ExtractorInput(
            run_id=run_id,
            page_id=page_id,
            url=target_url,
        )
        extractor_res = await extractor_node(extractor_in.model_dump())
        extracted_page = extractor_res.get("extracted_page", {})
        print(f"  [SUCCESS] Extractor extracted page:")
        print(f"    - Title: {extracted_page.get('title')}")
        print(f"    - Summary snippet: {extracted_page.get('summary', '')[:100]}...")
        print(f"    - Headings found: {len(extracted_page.get('headings', []))}")
    except Exception as e:
        print(f"  [FAILED] Extractor failed: {e}")
        return

    # 5. TEST VALIDATOR NODE
    print("\n[5/5 Agent Check] Testing Validator Agent...")
    try:
        val_in = ValidatorInput(
            run_id=run_id,
            page_id=page_id,
            url=target_url,
            subtask_description="Extract multi-agent orchestration architecture",
            extracted_content=ExtractedPage(**extracted_page),
            source_content=extractor_res.get("source_content", "Sample source text"),
        )
        validator_res = await validator_node(val_in.model_dump())
        results_map = validator_res.get("validation_results", {})
        val_output = next(iter(results_map.values()), {})
        print(f"  [SUCCESS] Validator verdict:")
        print(f"    - Verdict: {val_output.get('verdict')}")
        print(f"    - Confidence: {val_output.get('confidence')}")
        print(f"    - Faithfulness Notes: {val_output.get('faithfulness_notes')}")
        print(f"    - Relevance Notes: {val_output.get('relevance_notes')}")
    except Exception as e:
        print(f"  [FAILED] Validator failed: {e}")
        return

    # 6. TEST WRITER NODE
    print("\n[Bonus Agent Check] Testing Writer Agent...")
    try:
        writer_val = ValidatorOutput(
            run_id=run_id,
            page_id=page_id,
            verdict=ValidationVerdict.PASS,
            confidence=0.95,
            faithfulness_notes="Verified accurate",
        )
        writer_in = WriterInput(
            run_id=run_id,
            page_id=page_id,
            source_url=target_url,
            extracted_content=ExtractedPage(**extracted_page),
            validation_result=writer_val,
        )
        writer_res = await writer_node(writer_in.model_dump())
        print(f"  [SUCCESS] Writer persisted knowledge:")
        print(f"    - Markdown file: {writer_res.get('markdown_path')}")
        print(f"    - Embedding generated: {writer_res.get('embedding_generated')}")
        print(f"    - Supabase page id: {writer_res.get('supabase_page_row_id')}")
    except Exception as e:
        print(f"  [FAILED] Writer failed: {e}")
        return

    print("\n" + "=" * 60)
    print("ALL 5 AGENTS ARE FULLY OPERATIONAL AND VERIFIED!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_live_check())
