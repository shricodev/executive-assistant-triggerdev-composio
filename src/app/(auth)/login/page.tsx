import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-9" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Aide</h1>
            <p className="text-sm text-muted-foreground">
              Review what your assistant wants to send.
            </p>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
