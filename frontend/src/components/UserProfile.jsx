export default function UserProfile({ user }) {
  return (
    <div className="profile-container">
      <h2>Мои данные</h2>
      <div className="profile-card">
        <div className="profile-row">
          <span className="label">ID:</span>
          <span className="value">{user.id}</span>
        </div>
        <div className="profile-row">
          <span className="label">Username:</span>
          <span className="value">{user.username}</span>
        </div>
        <div className="profile-row">
          <span className="label">Email:</span>
          <span className="value">{user.email}</span>
        </div>
        <div className="profile-row">
          <span className="label">Имя:</span>
          <span className="value">{user.first_name || '—'}</span>
        </div>
        <div className="profile-row">
          <span className="label">Фамилия:</span>
          <span className="value">{user.last_name || '—'}</span>
        </div>
        <div className="profile-row">
          <span className="label">Роль:</span>
          <span className="value">{getRoleLabel(user.role)}</span>
        </div>
      </div>
    </div>
  );
}

function getRoleLabel(role) {
  switch (role) {
    case 'admin':
      return 'Администратор';
    case 'superviser':
      return 'Супервизор';
    case 'common':
    default:
      return 'Пользователь';
  }
}