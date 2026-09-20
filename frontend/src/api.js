const API_BASE = '/auth';

export async function getMe() {
  const res = await fetch(`${API_BASE}/me`);
  if (!res.ok) {
    if (res.status === 401) return null;
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function getUsers(limit = 100, offset = 0) {
  const res = await fetch(`${API_BASE}/users?limit=${limit}&offset=${offset}`);
  if (!res.ok) {
    if (res.status === 401) return null;
    if (res.status === 403) throw new Error('Forbidden: admin access required');
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function getUser(userId) {
  const res = await fetch(`${API_BASE}/users/${userId}`);
  if (!res.ok) {
    if (res.status === 401) return null;
    if (res.status === 403) throw new Error('Forbidden: admin access required');
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function createUser(data) {
  const res = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    if (res.status === 401) return null;
    if (res.status === 403) throw new Error('Forbidden: admin access required');
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateUser(userId, data) {
  const res = await fetch(`${API_BASE}/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    if (res.status === 401) return null;
    if (res.status === 403) throw new Error('Forbidden: admin access required');
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteUser(userId) {
  const res = await fetch(`${API_BASE}/users/${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    if (res.status === 401) return null;
    if (res.status === 403) throw new Error('Forbidden: admin access required');
    throw new Error(`HTTP ${res.status}`);
  }
  return true;
}

export async function logout() {
  const res = await fetch(`${API_BASE}/logout`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return true;
}