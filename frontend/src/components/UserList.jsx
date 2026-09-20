import { useState, useEffect } from 'react';
import { getUsers, deleteUser, createUser, updateUser } from '../api.js';
import UserForm from './UserForm.jsx';

export default function UserList() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getUsers();
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId) => {
    if (!confirm('Удалить пользователя?')) return;
    try {
      await deleteUser(userId);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreate = async (data) => {
    await createUser(data);
    setShowForm(false);
    await loadUsers();
  };

  const handleUpdate = async (data) => {
    await updateUser(editingUser.id, data);
    setEditingUser(null);
    await loadUsers();
  };

  const handleEdit = (user) => {
    setEditingUser(user);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingUser(null);
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="user-list-container">
      <div className="header">
        <h2>Пользователи</h2>
        <button onClick={() => setShowForm(true)} className="btn btn-primary">
          + Создать
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <table className="user-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Имя</th>
            <th>Фамилия</th>
            <th>Роль</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.email}</td>
              <td>{user.first_name || '—'}</td>
              <td>{user.last_name || '—'}</td>
              <td>{getRoleLabel(user.role)}</td>
              <td>
                <button onClick={() => handleEdit(user)} className="btn btn-small">
                  Ред.
                </button>
                <button
                  onClick={() => handleDelete(user.id)}
                  className="btn btn-small btn-danger"
                >
                  Уд.
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {users.length === 0 && <p className="empty">Нет пользователей</p>}

      {showForm && (
        <UserForm
          onSubmit={handleCreate}
          onCancel={handleCancel}
          isEdit={false}
        />
      )}

      {editingUser && (
        <UserForm
          user={editingUser}
          onSubmit={handleUpdate}
          onCancel={handleCancel}
          isEdit={true}
        />
      )}
    </div>
  );
}

function getRoleLabel(role) {
  switch (role) {
    case 'admin':
      return 'Админ';
    case 'superviser':
      return 'Суп.';
    case 'common':
    default:
      return 'Юзер';
  }
}