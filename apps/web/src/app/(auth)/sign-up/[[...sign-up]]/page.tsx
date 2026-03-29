import { SignUp } from "@clerk/nextjs";
import { UserPlus } from "lucide-react";

export default function SignUpPage() {
  return (
    <div className="w-full max-w-lg">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <UserPlus className="size-5 text-primary" />
          Create your account
        </div>
        <p className="text-sm text-muted-foreground">
          Get started with Present for your worship services.
        </p>
      </div>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/dashboard" />
    </div>
  );
}
