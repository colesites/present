import { ServiceEditorPage } from "../../../components/services/ServiceEditorPage";

export default async function ServicePage({ params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;
  return <ServiceEditorPage serviceId={serviceId} />;
}
