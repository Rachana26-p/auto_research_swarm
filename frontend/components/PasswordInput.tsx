"use client";

import React, { useState } from "react";
import { EyeIcon, EyeOffIcon } from "./Icons";

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function PasswordInput({
  label,
  error,
  className = "",
  ...props
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between items-center">
          <label className="block font-['Space_Grotesk'] font-bold text-xs uppercase text-[#0A0A0A] dark:text-[#EDEEF2]">
            {label}
          </label>
        </div>
      )}
      <div className="relative flex items-center">
        <input
          type={showPassword ? "text" : "password"}
          className={`w-full border-2 border-[#0A0A0A] dark:border-[#2C3142] p-2.5 pr-10 font-mono text-xs bg-[#FFFFFF] dark:bg-[#0C0D12] text-[#0A0A0A] dark:text-[#EDEEF2] focus:outline-none focus:border-[#E63946] dark:focus:border-[#FF5C6C] transition-colors ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-2.5 p-1 text-[#0A0A0A]/60 dark:text-[#EDEEF2]/60 hover:text-[#0A0A0A] dark:hover:text-[#EDEEF2] cursor-pointer select-none transition-colors flex items-center justify-center"
          title={showPassword ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        </button>
      </div>
      {error && (
        <span className="font-mono text-[11px] text-[#E63946] dark:text-[#FF5C6C] block mt-0.5">
          {error}
        </span>
      )}
    </div>
  );
}
