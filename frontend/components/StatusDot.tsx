import React from "react";

export type StatusType =
  | "pending"
  | "running"
  | "completed"
  | "success"
  | "validated"
  | "interrupted"
  | "failed"
  | "rejected"
  | "idle";

interface StatusDotProps {
  status: StatusType | string;
  size?: "sm" | "md" | "lg";
  className?: string;
  pulse?: boolean;
}

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  size = "md",
  className = "",
  pulse = false,
}) => {
  const normStatus = status.toLowerCase();

  // Status color mapping per ui-registry.md
  let bgColor = "bg-[#F4A300]"; // yellow by default (pending)
  if (normStatus === "running" || normStatus === "in_progress") {
    bgColor = "bg-[#1D3557]"; // blue
  } else if (
    normStatus === "completed" ||
    normStatus === "success" ||
    normStatus === "validated" ||
    normStatus === "pass"
  ) {
    bgColor = "bg-[#2A9D8F]"; // green
  } else if (
    normStatus === "failed" ||
    normStatus === "rejected" ||
    normStatus === "error" ||
    normStatus === "block"
  ) {
    bgColor = "bg-[#E63946]"; // red
  } else if (normStatus === "interrupted" || normStatus === "uncertain") {
    bgColor = "bg-[#F4A300]"; // yellow
  }

  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  }[size];

  const isPulsing = pulse || normStatus === "running";

  return (
    <span
      className={`inline-block rounded-full ${sizeClasses} ${bgColor} ${
        isPulsing ? "animate-pulse" : ""
      } ${className}`}
      title={`Status: ${status}`}
      aria-label={`Status: ${status}`}
    />
  );
};

export default StatusDot;
