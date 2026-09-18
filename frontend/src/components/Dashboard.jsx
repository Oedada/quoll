import { logout } from '../api.js';
import UserList from './UserList.jsx';
import UserProfile from './UserProfile.jsx';

export default function Dashboard({ user }) {
  const isAdmin = user.role === 'admin';

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Quoll</h1>
        <div className="user-info">
          <span>{user.username}</span>
          <span className="role-badge">{getRoleLabel(user.role)}</span>
          <button
            onClick={() => {
              logout();
              window.location.reload();
            }}
            className="btn btn-small"
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="dashboard-content">
        {isAdmin ? <UserList /> : <UserProfile user={user} />}
      </main>
    </div>
  );
}

function getRoleLabel(role) {
  switch (role) {
    case 'admin':
      return 'Админ';
    case 'superviser':
      return 'Супервизор';
    case 'common':
    default:
      return 'Пользователь';
  }
}