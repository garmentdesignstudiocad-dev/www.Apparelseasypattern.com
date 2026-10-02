(() => {
  const form = document.getElementById('appearance-form');
  const preview = document.getElementById('theme-preview');
  const fonts = { 'DM Sans': '"DM Sans",Arial,sans-serif', 'Playfair Display': '"Playfair Display",Georgia,serif', Arial: 'Arial,sans-serif', Helvetica: 'Helvetica,Arial,sans-serif', Georgia: 'Georgia,serif', 'Times New Roman': '"Times New Roman",serif', Verdana: 'Verdana,sans-serif', Poppins: 'Poppins,Arial,sans-serif', Inter: 'Inter,Arial,sans-serif' };
  function update() {
    form.querySelectorAll('[data-color-for]').forEach(picker => {
      const field = form.elements[picker.dataset.colorFor];
      if (/^#[0-9a-f]{6}$/i.test(field.value)) {
        picker.value = field.value;
        preview.style.setProperty('--' + field.name.replaceAll('_', '-'), field.value);
      }
    });
    ['main_font', 'heading_font'].forEach(key => preview.style.setProperty('--' + key.replaceAll('_', '-'), fonts[form.elements[key].value] || fonts.Arial));
    const size = Number(form.elements.base_font_size.value);
    if (Number.isInteger(size) && size >= 14 && size <= 20) preview.style.setProperty('--base-font-size', size + 'px');
    preview.style.setProperty('--heading-style', form.elements.heading_style.value === 'italic' ? 'italic' : 'normal');
    preview.style.setProperty('--button-radius', { rounded: '999px', 'slightly-rounded': '9px', square: '0' }[form.elements.button_style.value]);
    preview.style.setProperty('--card-border', form.elements.card_style.value === 'border' ? '1px solid var(--border)' : '1px solid transparent');
    preview.style.setProperty('--card-shadow', form.elements.card_style.value === 'soft-shadow' ? '0 12px 35px rgba(35,25,20,.10)' : 'none');
    preview.style.setProperty('--card-padding', form.elements.layout_density.value === 'compact' ? '16px' : '24px');
    preview.querySelectorAll('[data-preview]').forEach(element => { element.textContent = form.elements[element.dataset.preview].value; });
  }
  form.querySelectorAll('[data-color-for]').forEach(picker => picker.addEventListener('input', () => { form.elements[picker.dataset.colorFor].value = picker.value; update(); }));
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  document.getElementById('appearance-reset').addEventListener('submit', event => {
    if (!window.confirm('Reset colors, fonts and styles to their defaults? Branding and text will be kept.')) event.preventDefault();
  });
  update();
})();
