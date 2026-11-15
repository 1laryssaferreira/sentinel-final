// Site comercial — menu do celular e ano do rodapé.
(function () {
  const ano = document.getElementById('anoAtual');
  if (ano) ano.textContent = new Date().getFullYear();

  const botaoMenu = document.querySelector('.topo-menu');
  const menu = document.getElementById('menuMovel');
  if (botaoMenu && menu) {
    botaoMenu.addEventListener('click', () => {
      const aberto = botaoMenu.getAttribute('aria-expanded') === 'true';
      botaoMenu.setAttribute('aria-expanded', String(!aberto));
      menu.hidden = aberto;
    });
    menu.addEventListener('click', (e) => {
      if (e.target.tagName !== 'A') return;
      botaoMenu.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
    });
  }
})();
