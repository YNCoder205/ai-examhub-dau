import { useState } from 'react';

type AvatarPickerProps = {
  name: string;
  value?: string | null;
  onChange: (avatar: string | null) => void;
};

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_DIMENSION = 384;

export default function AvatarPicker({ name, value, onChange }: AvatarPickerProps) {
  const [error, setError] = useState('');
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  const handleFile = (file?: File) => {
    setError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Chọn ảnh JPG, PNG hoặc WebP.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Ảnh gốc cần nhỏ hơn 8 MB.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        setError('Trình duyệt không thể xử lý ảnh này.');
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const avatar = canvas.toDataURL('image/jpeg', 0.82);
      if (avatar.length > 700_000) {
        setError('Ảnh sau xử lý vẫn quá lớn. Vui lòng chọn ảnh khác.');
        return;
      }
      onChange(avatar);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError('Không thể đọc tệp ảnh này.');
    };
    image.src = objectUrl;
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-preview">
        {value ? <img src={value} alt={`Ảnh đại diện của ${name || 'người dùng'}`} /> : <span>{initial}</span>}
      </div>
      <div className="avatar-picker-actions">
        <label className="button-secondary avatar-picker-button">
          Chọn ảnh đại diện
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              handleFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
        </label>
        {value && <button className="text-button" type="button" onClick={() => onChange(null)}>Gỡ ảnh</button>}
        <small>JPG, PNG hoặc WebP · tối đa 8 MB</small>
        {error && <span className="form-error" role="alert">{error}</span>}
      </div>
    </div>
  );
}
