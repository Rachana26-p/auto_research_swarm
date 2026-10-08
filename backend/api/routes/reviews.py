"""
Routes for human-in-the-loop review of UNCERTAIN extraction items.
Allows approving or rejecting items to resume interrupted supervisor runs.
"""

from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status

from api.deps import verify_api_key
from api.models import ReviewActionResponse, ReviewResponse
from api.state import run_manager

router = APIRouter(prefix="/reviews", tags=["reviews"], dependencies=[Depends(verify_api_key)])


@router.get("", response_model=list[ReviewResponse])
async def list_pending_reviews() -> list[ReviewResponse]:
    """Retrieve all pending UNCERTAIN items awaiting human decision."""
    reviews = run_manager.list_pending_reviews()
    return [
        ReviewResponse(
            id=r.id,
            run_id=r.run_id,
            page_id=r.page_id,
            url=r.url,
            status=r.status,
            validator_output=r.validator_output,
            created_at=r.created_at,
        )
        for r in reviews
    ]


@router.post("/{review_id}/approve", response_model=ReviewActionResponse)
async def approve_review(review_id: UUID) -> ReviewActionResponse:
    """
    Approve an UNCERTAIN item and resume the interrupted supervisor run.
    """
    review = run_manager.get_review(review_id)
    if not review:
        raise HTTPException(status_code=404, detail=f"Review '{review_id}' not found")
    if review.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Review '{review_id}' is already {review.status}",
        )

    resumed_run = await run_manager.resume_run(review_id, decision="approve")
    if not resumed_run:
        raise HTTPException(status_code=500, detail="Failed to resume run from checkpoint")

    return ReviewActionResponse(
        review_id=review_id,
        run_id=review.run_id,
        status="approved",
        message="Item approved. Supervisor run resumed.",
    )


@router.post("/{review_id}/reject", response_model=ReviewActionResponse)
async def reject_review(review_id: UUID) -> ReviewActionResponse:
    """
    Reject an UNCERTAIN item and resume the interrupted supervisor run (discarding item).
    """
    review = run_manager.get_review(review_id)
    if not review:
        raise HTTPException(status_code=404, detail=f"Review '{review_id}' not found")
    if review.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Review '{review_id}' is already {review.status}",
        )

    resumed_run = await run_manager.resume_run(review_id, decision="reject")
    if not resumed_run:
        raise HTTPException(status_code=500, detail="Failed to resume run from checkpoint")

    return ReviewActionResponse(
        review_id=review_id,
        run_id=review.run_id,
        status="rejected",
        message="Item rejected. Supervisor run resumed with item discarded.",
    )
