(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          reveal.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });
    document.querySelectorAll('.section-head, .web-service, .extras article, .profile-grid')
      .forEach(element => reveal.observe(element));
  }

  const gallery = document.getElementById('vitrine-geradores');
  const cards = Array.from(gallery.querySelectorAll('.generator'));
  const controls = document.querySelector('.gallery-controls');
  const count = controls.querySelector('.gallery-count');
  const previous = controls.querySelector('.prev');
  const next = controls.querySelector('.next');
  const mobile = window.matchMedia('(max-width: 700px)');
  let active = -1;
  let destination = null;
  let frame = 0;

  function setActive(index) {
    if (active === index) return;
    if (active >= 0) cards[active].classList.remove('is-current');
    active = index;
    cards[index].classList.add('is-current');
    count.textContent = (index + 1) + ' de ' + cards.length;
    controls.style.setProperty('--gallery-progress', (index + 1) / cards.length * 100 + '%');
    previous.setAttribute('aria-disabled', String(index === 0));
    next.setAttribute('aria-disabled', String(index === cards.length - 1));
  }

  function trackScroll() {
    frame = 0;
    if (!mobile.matches) return;
    const box = gallery.getBoundingClientRect();
    const center = box.left + box.width / 2;
    let nearest = 0;
    let distance = Infinity;
    cards.forEach((card, index) => {
      const bounds = card.getBoundingClientRect();
      const delta = Math.abs(bounds.left + bounds.width / 2 - center);
      if (delta < distance) {
        nearest = index;
        distance = delta;
      }
    });
    if (nearest === destination) destination = null;
    if (destination === null) setActive(nearest);
  }

  function queueUpdate() {
    if (!frame && mobile.matches) frame = requestAnimationFrame(trackScroll);
  }

  function move(step) {
    const index = active + step;
    if (index < 0 || index >= cards.length) return;
    const box = gallery.getBoundingClientRect();
    const card = cards[index].getBoundingClientRect();
    destination = index;
    setActive(index);
    gallery.scrollBy({
      left: card.left - box.left + (card.width - box.width) / 2,
      behavior: reduceMotion.matches ? 'instant' : 'smooth'
    });
  }

  function syncLayout() {
    destination = null;
    controls.hidden = !mobile.matches;
    gallery.classList.toggle('has-controls', mobile.matches);
    if (mobile.matches) trackScroll();
  }

  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  for (const event of ['pointerdown', 'wheel', 'keydown', 'focusin']) {
    gallery.addEventListener(event, () => { destination = null; }, { passive: true });
  }
  gallery.addEventListener('scroll', queueUpdate, { passive: true });
  window.addEventListener('resize', syncLayout, { passive: true });
  syncLayout();
})();
