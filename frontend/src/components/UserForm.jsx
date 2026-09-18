import { useState } from 'react';

export default function UserForm({ user, onSubmit, onCancel, isEdit }) {
  const [formData, setFormData] = useState({
    username: user?.username || '',
    email: user?.email || '',
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    password: '',
    role: user?.role || 'common',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = { ...formData };
      if (!isEdit && !data.password) {
        setError('Пароль обязателен');
        setLoading(false);
        return;
      }
      if (isEdit) {
        delete data.username;
        delete data.password;
        delete data.role;
        if (!data.email) delete data.email;
        if (!data.first_name) delete data.first_name;
        if (!data.last_name) delete data.last_name;
      }
      await onSubmit(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{isEdit ? 'Редактировать пользователя' : 'Создать пользователя'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username:</label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              disabled={isEdit}
              required={!isEdit}
            />
          </div>
          <div className="form-group">
            <label>Email:</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required={!isEdit}
            />
          </div>
          <div className="form-group">
            <label>Имя:</label>
            <input
              type="text"
              name="first_name"
              value={formData.first_name}
              onChange={handleChange}
            />
          </div>
          <div className="form-group">
            <label>Фамилия:</label>
            <input
              type="text"
              name="last_name"
              value={formData.last_name}
              onChange={handleChange}
            />
          </div>
          {!isEdit && (
            <div className="form-group">
              <label>Пароль:</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
              />
            </div>
          )}
          {!isEdit && (
            <div className="form-group">
              <label>Роль:</label>
              <select name="role" value={formData.role} onChange={handleChange}>
                <option value="common">Пользователь</option>
                <option value="superviser">Супервизор</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="form-actions">
            <button type="button" onClick={onCancel} className="btn btn-secondary">
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}