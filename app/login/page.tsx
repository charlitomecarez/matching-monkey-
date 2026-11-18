import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "Sign in · Item Matching" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-line p-6">
        <h1 className="text-lg font-semibold">Item Matching</h1>
        <p className="mb-6 text-sm text-muted">Sign in with the account you were invited with.</p>
        <LoginForm />
      </div>
    </main>
  );
}
