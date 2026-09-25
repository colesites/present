import { Suspense } from "react";
import { ServicesListPage } from "../../components/services/ServicesListPage";

export default function ServicesPage() {
  return (
    <Suspense>
      <ServicesListPage />
    </Suspense>
  );
}
