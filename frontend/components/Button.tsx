import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  ...props
}) => {
  const baseClasses =
    "inline-flex items-center justify-center font-['Space_Grotesk'] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed radius-sm cursor-pointer select-none";

  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-5 py-2.5 text-sm",
    lg: "px-6 py-3.5 text-base",
  }[size];

  let variantClasses = "";
  if (variant === "primary") {
    variantClasses =
      "bg-[#0A0A0A] text-[#FAFAFA] dark:bg-[#EDEEF2] dark:text-[#0A0A0A] hover:bg-[#E63946] dark:hover:bg-[#FF5C6C] dark:hover:text-[#FAFAFA] active:bg-[#0A0A0A]";
  } else if (variant === "outline") {
    variantClasses =
      "bg-transparent text-[#0A0A0A] border-2 border-[#0A0A0A] dark:text-[#EDEEF2] dark:border-[#2C3142] hover:bg-[#0A0A0A] hover:text-[#FAFAFA] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] active:bg-[#1D3557]";
  } else if (variant === "danger") {
    variantClasses =
      "bg-[#E63946] text-[#FAFAFA] dark:bg-[#FF5C6C] dark:text-[#FAFAFA] hover:bg-[#0A0A0A] dark:hover:bg-[#EDEEF2] dark:hover:text-[#0A0A0A] active:bg-[#E63946]";
  }

  return (
    <button
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-current border-t-transparent animate-spin rounded-full inline-block" />
          <span>Processing...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;
