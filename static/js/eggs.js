const audio = document.querySelector('#eggsMusic');
const eggTap = document.querySelector('#eggTap');

if (audio && eggTap) {
  eggTap.addEventListener('click', () => {
    audio.play().then(() => {
      eggTap.hidden = true;
    }).catch((error) => {
      console.error('Eggs music playback failed:', error);
    });
  });
}
