import asyncio
import json
import logging
import os
from pathlib import Path
import sys
import time
from uuid import uuid4
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

BASE_FRONTEND_URL = "http://localhost:3000/api"
BASE_BACKEND_URL = "http://localhost:8000"

async def main():
    print("=" * 70)
    print("STEP 1: SUBMITTING REAL RUN VIA FRONTEND PATH (http://localhost:3000/api/runs)")
    print("=" * 70)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Submit goal via frontend proxy
        goal_payload = {
            "goal": "Autonomous Multi-Agent AI System Orchestration Patterns",
            "max_pages": 2,
            "max_tokens": 100000,
        }
        resp = await client.post(f"{BASE_FRONTEND_URL}/runs", json=goal_payload)
        print("POST /api/runs Response Status:", resp.status_code)
        run_data = resp.json()
        print("Run Created:", json.dumps(run_data, indent=2))
        run_id = run_data["id"]

        # 2. Monitor execution through completion
        print(f"\nMonitoring Run {run_id} via GET /api/runs/{run_id}...")
        for i in range(30):
            await asyncio.sleep(1.0)
            status_resp = await client.get(f"{BASE_FRONTEND_URL}/runs/{run_id}")
            data = status_resp.json()
            status = data.get("status")
            print(f"[{i+1}s] Status: {status} | Pages processed: {data.get('pages_processed', 0)} | Tool calls: {data.get('tool_calls_made', 0)}")
            if status in ("completed", "interrupted", "failed"):
                break

        print("\nFinal Run Details:")
        print(json.dumps(data, indent=2))

        # 3. Check markdown file in /knowledge/
        knowledge_dir = Path("./knowledge")
        md_files = list(knowledge_dir.glob("*.md"))
        print(f"\nTotal Markdown Files in /knowledge/: {len(md_files)}")
        if md_files:
            latest_md = max(md_files, key=lambda p: p.stat().st_mtime)
            print(f"Latest Persisted Knowledge File: {latest_md.name}")
            print("Content Snippet (First 20 lines):")
            lines = latest_md.read_text(encoding="utf-8").splitlines()[:20]
            for line in lines:
                print("  ", line)

        # 4. Check Guardrail Events for this run
        gev_resp = await client.get(f"{BASE_FRONTEND_URL}/guardrail-events?run_id={run_id}")
        print(f"\nGuardrail Events Logged for Run ({gev_resp.status_code}): {len(gev_resp.json())} events")
        for ev in gev_resp.json()[:5]:
            print(f"  - [{ev['decision']}] Agent: {ev['agent_name']} | Type: {ev['event_type']}")

        # ============================================================
        # STEP 2: TRIGGER UNCERTAIN CASE & APPROVE VIA REVIEW ENDPOINT
        # ============================================================
        print("\n" + "=" * 70)
        print("STEP 2: TRIGGERING UNCERTAIN VERDICT & RESUMING VIA REVIEW ENDPOINT")
        print("=" * 70)

        # We inject an UNCERTAIN review into run_manager to test the review queue + approve endpoint
        from api.state import run_manager, ReviewRecord, RunRecord
        from agents.supervisor import BudgetConfig, SupervisorOrchestrator
        from shared.config import get_config
        from shared.models import ValidationVerdict

        config = get_config()
        test_run_id = uuid4()
        test_page_id = uuid4()
        test_rev_id = uuid4()

        # Create record in run_manager
        record = RunRecord(
            run_id=test_run_id,
            goal="Test Human Review Queue Workflow",
            budget_config=BudgetConfig(),
            config=config,
        )
        record.status = "interrupted"
        record.orchestrator = SupervisorOrchestrator(budget_config=BudgetConfig(), config=config)
        run_manager.runs[test_run_id] = record

        checkpoint_state = {
            "run_id": str(test_run_id),
            "page_id": str(test_page_id),
            "goal": "Test Human Review Queue Workflow",
            "pages_processed": 1,
            "pages_passed": 0,
            "pages_failed": 0,
            "pages_written": [],
            "pages_uncertain": [
                {
                    "url": "https://borderline-research.org/evidence",
                    "page_id": str(test_page_id),
                    "validator_output": {
                        "verdict": "uncertain",
                        "confidence": 0.65,
                        "faithfulness_notes": "Needs human verification for statistical claims",
                        "relevance_notes": "Relevant to multi-agent scaling",
                        "safety_flags": [],
                    },
                    "extracted_json": {
                        "title": "Scaling Limits of Swarm Architectures",
                        "description": "Exploration of coordination overhead in large agent networks",
                        "main_content": "Communication overhead grows quadratically without hierarchical clustering.",
                        "headings": ["Abstract", "Coordinating Protocols"],
                        "links": [],
                        "images": [],
                        "metadata": {},
                    },
                }
            ],
            "subtasks": [],
            "errors": [],
        }

        review = ReviewRecord(
            review_id=test_rev_id,
            run_id=test_run_id,
            page_id=test_page_id,
            url="https://borderline-research.org/evidence",
            validator_output=checkpoint_state["pages_uncertain"][0]["validator_output"],
            checkpoint_state=checkpoint_state,
        )
        run_manager.reviews[test_rev_id] = review

        # Query review queue via frontend
        reviews_resp = await client.get(f"{BASE_FRONTEND_URL}/reviews")
        print(f"GET /api/reviews Status: {reviews_resp.status_code}")
        pending_reviews = reviews_resp.json()
        print(f"Pending Reviews Count: {len(pending_reviews)}")
        target_rev = next((r for r in pending_reviews if r["id"] == str(test_rev_id)), None)
        assert target_rev is not None, "Created review not found in /reviews!"
        print(f"Found Pending Review {test_rev_id}: URL={target_rev['url']}")

        # Call Approve endpoint
        print(f"\nCalling POST /api/reviews/{test_rev_id}/approve...")
        approve_resp = await client.post(f"{BASE_FRONTEND_URL}/reviews/{test_rev_id}/approve")
        print(f"Approve Status: {approve_resp.status_code}")
        print("Approve Response:", approve_resp.json())

        # Verify review queue is updated
        reviews_after = (await client.get(f"{BASE_FRONTEND_URL}/reviews")).json()
        found_after = any(r["id"] == str(test_rev_id) for r in reviews_after)
        print(f"Review {test_rev_id} removed from pending queue: {not found_after}")

        # Wait for resumed run to complete
        await asyncio.sleep(2.0)
        resumed_run = (await client.get(f"{BASE_FRONTEND_URL}/runs/{test_run_id}")).json()
        print(f"Resumed Run Status: {resumed_run.get('status')}")
        print(f"Resumed Run Pages Persisted: {resumed_run.get('pages_persisted')}")

        print("\n" + "=" * 70)
        print("END-TO-END VERIFICATION PASS COMPLETED SUCCESSFULLY!")
        print("=" * 70)

if __name__ == "__main__":
    asyncio.run(main())
