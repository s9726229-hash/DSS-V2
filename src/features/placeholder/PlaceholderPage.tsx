import './PlaceholderPage.css';

export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="placeholder">
      <h1 className="placeholder__title">{title}</h1>
      <p className="placeholder__description">{description}</p>
      <p className="placeholder__state micro">尚未建置</p>
    </div>
  );
}
