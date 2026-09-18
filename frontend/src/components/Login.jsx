export default function Login() {
  const handleLogin = () => {
    window.location.href = '/auth/auth';
  };

  return (
    <div className="login-container">
      <h1>Quoll</h1>
      <p>Пожалуйста, войдите для продолжения</p>
      <button onClick={handleLogin} className="btn btn-primary">
        Войти через Keycloak
      </button>
    </div>
  );
}