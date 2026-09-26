import { SongEditorPage } from "../../../components/library/SongEditorPage";

export default async function SongPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <SongEditorPage itemId={itemId} />;
}
