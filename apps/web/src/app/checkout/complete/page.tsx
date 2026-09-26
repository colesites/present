import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutComplete } from "./CheckoutComplete";

export const metadata: Metadata = {
  title: "Payment | Present",
  robots: { index: false },
};

export default function CheckoutCompletePage() {
  return (
    <Suspense>
      <CheckoutComplete />
    </Suspense>
  );
}
