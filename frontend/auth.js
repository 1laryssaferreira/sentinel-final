// ==========================================================
// AUTENTICAÇÃO REAL — fala com o back-end (Express + MySQL)
// Antes disso era simulada só com localStorage; agora o
// e-mail/senha são conferidos no servidor e a sessão usa um
// token JWT emitido pelo back-end.
// ==========================================================
// Usa o mesmo host de onde a página foi carregada (funciona em localhost,
// 127.0.0.1 ou o IP da rede — importante pra funcionar também no celular,
// onde "localhost" significaria o próprio celular, não o computador).
const API_BASE = (window.SENTINEL && window.SENTINEL.api) || `http://${window.location.hostname || 'localhost'}:3001/api`;
const SENTINEL_SESSION_KEY = 'sentinel_session_v2';

// "Lembrar de mim" marcado → localStorage (continua logado depois de
// fechar o navegador). Desmarcado → sessionStorage (sai ao fechar a aba).
function setSession(usuario, token, lembrar = true) {
  const session = { ...usuario, token, loggedAt: new Date().toISOString() };
  localStorage.removeItem(SENTINEL_SESSION_KEY);
  sessionStorage.removeItem(SENTINEL_SESSION_KEY);
  (lembrar ? localStorage : sessionStorage).setItem(SENTINEL_SESSION_KEY, JSON.stringify(session));
  return session;
}

function getSession() {
  try {
    const bruto = sessionStorage.getItem(SENTINEL_SESSION_KEY) || localStorage.getItem(SENTINEL_SESSION_KEY);
    const sessao = bruto ? JSON.parse(bruto) : null;
    if (!sessao?.token) return null;
    // O token JWT expira em 12h: confere a data dentro dele pra não
    // mandar o operador pro painel com uma sessão que o servidor recusa.
    const payload = JSON.parse(atob(sessao.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(SENTINEL_SESSION_KEY);
      sessionStorage.removeItem(SENTINEL_SESSION_KEY);
      return null;
    }
    return sessao;
  } catch {
    return null;
  }
}

function getAuthToken() {
  return getSession()?.token || null;
}

function logoutSentinel() {
  localStorage.removeItem(SENTINEL_SESSION_KEY);
  sessionStorage.removeItem(SENTINEL_SESSION_KEY);
  window.location.href = 'login.html?force=1';
}

function setFeedback(element, message, type = 'error') {
  if (!element) return;
  element.textContent = message;
  element.className = `form-feedback ${type}`;
  element.hidden = false;
}

function clearFeedback(element) {
  if (!element) return;
  element.hidden = true;
  element.textContent = '';
}

function togglePassword(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Mostrar' : 'Ocultar';
  button.setAttribute('aria-pressed', String(!showing));
}

function handleLogin() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  const feedback = document.getElementById('loginFeedback');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFeedback(feedback);

    const email = emailInput.value.trim().toLowerCase();
    const senha = passwordInput.value;

    if (!email || !senha) {
      setFeedback(feedback, 'Preencha seu e-mail e sua senha.');
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Autenticando...';

    try {
      const resposta = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        setFeedback(feedback, dados.erro || 'Não foi possível entrar. Tente novamente.');
        submitButton.disabled = false;
        submitButton.textContent = 'Entrar';
        return;
      }

      setSession(dados.usuario, dados.token, document.getElementById('remember')?.checked ?? true);
      window.location.href = 'painel.html';
    } catch (erro) {
      console.error('Erro ao autenticar:', erro);
      setFeedback(feedback, 'Não foi possível falar com o servidor. O back-end (porta 3001) está rodando?');
      submitButton.disabled = false;
      submitButton.textContent = 'Entrar';
    }
  });

  document.getElementById('fillDemo')?.addEventListener('click', () => {
    emailInput.value = 'operador@sentinel.com';
    passwordInput.value = 'Sentinel123';
    emailInput.focus();
  });
}

function handleRegister() {
  const form = document.getElementById('registerForm');
  if (!form) return;

  const feedback = document.getElementById('registerFeedback');
  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('confirmPassword');
  const strengthBar = document.getElementById('passwordStrength');
  const strengthLabel = document.getElementById('passwordStrengthLabel');

  passwordInput?.addEventListener('input', () => {
    const value = passwordInput.value;
    let score = 0;
    if (value.length >= 8) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;

    const labels = ['Muito fraca', 'Fraca', 'Média', 'Forte', 'Muito forte'];
    const widths = ['8%', '25%', '50%', '75%', '100%'];
    if (strengthBar) strengthBar.style.width = widths[score];
    if (strengthBar) strengthBar.dataset.level = String(score);
    if (strengthLabel) strengthLabel.textContent = labels[score];
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFeedback(feedback);

    const nome = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const senha = passwordInput.value;
    const confirmarSenha = confirmInput.value;
    const terms = document.getElementById('terms').checked;

    if (nome.length < 3) {
      setFeedback(feedback, 'Digite seu nome completo.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setFeedback(feedback, 'Digite um e-mail válido.');
      return;
    }
    if (senha.length < 8 || !/[A-Z]/.test(senha) || !/[0-9]/.test(senha)) {
      setFeedback(feedback, 'A senha precisa ter pelo menos 8 caracteres, uma letra maiúscula e um número.');
      return;
    }
    if (senha !== confirmarSenha) {
      setFeedback(feedback, 'As senhas não coincidem.');
      return;
    }
    if (!terms) {
      setFeedback(feedback, 'Aceite os termos de uso para continuar.');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Criando conta...';

    try {
      const resposta = await fetch(`${API_BASE}/auth/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, senha })
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        setFeedback(feedback, dados.erro || 'Não foi possível criar a conta.');
        submitButton.disabled = false;
        submitButton.textContent = 'Criar conta';
        return;
      }

      setSession(dados.usuario, dados.token);
      setFeedback(feedback, 'Conta criada com sucesso. Redirecionando...', 'success');
      setTimeout(() => { window.location.href = 'painel.html'; }, 500);
    } catch (erro) {
      console.error('Erro ao registrar:', erro);
      setFeedback(feedback, 'Não foi possível falar com o servidor. O back-end (porta 3001) está rodando?');
      submitButton.disabled = false;
      submitButton.textContent = 'Criar conta';
    }
  });
}

function protectDashboard() {
  if (!document.body.classList.contains('dashboard-page')) return;

  const session = getSession();
  if (!session) {
    window.location.replace('login.html');
    return;
  }

  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  const userAvatar = document.getElementById('userAvatar');

  if (userName) userName.textContent = session.nome;
  if (userRole) userRole.textContent = session.papel || 'Operador';
  if (userAvatar) {
    const initials = (session.nome || '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('');
    userAvatar.textContent = initials || 'OP';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const session = getSession();
  if (document.body.classList.contains('auth-page') && session) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('force') !== '1') window.location.href = 'painel.html';
  }

  handleLogin();
  handleRegister();
  protectDashboard();
});
