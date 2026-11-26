export const SOUND_PATTERNS={
  'complete-soft':[[523,523,0,.19,.65],[784,784,.12,.27,.5]],
  'complete-chime':[[587,587,0,.18,.65],[740,740,.095,.2,.48],[880,880,.19,.32,.4]],
  'complete-digital':[[880,880,0,.085,.65],[1175,1175,.09,.13,.5]],
  tap:[[520,440,0,.075,.7]],
  navigate:[[620,740,0,.08,.5],[930,930,.045,.10,.28]],
  open:[[460,760,0,.13,.6],[960,1040,.055,.12,.25]],
  close:[[650,390,0,.11,.55]],
  on:[[650,900,0,.09,.6],[1100,1100,.04,.09,.3]],
  off:[[650,420,0,.10,.55]],
  success:[[660,660,0,.10,.5],[990,990,.055,.13,.35]],
  error:[[260,210,0,.11,.5],[230,170,.085,.13,.32]],
  startup:[[440,440,0,.20,.34],[554,554,.07,.22,.25],[830,830,.14,.27,.20]],
  next:[[680,960,0,.08,.5]],
  previous:[[960,680,0,.08,.5]]
};
export function playUISound(context,kind='tap',volume=28){
  const strength=Math.max(0,Math.min(100,Number(volume)||0))/100;
  if(!strength)return;
  const now=context.currentTime;
  for(const [from,to,delay,duration,level] of SOUND_PATTERNS[kind]||SOUND_PATTERNS.tap){
    const oscillator=context.createOscillator(),gain=context.createGain();
    const start=now+delay;oscillator.type='sine';
    oscillator.frequency.setValueAtTime(from,start);oscillator.frequency.exponentialRampToValueAtTime(to,start+duration);
    gain.gain.setValueAtTime(.0001,start);gain.gain.linearRampToValueAtTime(.055*strength*level,start+.009);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    oscillator.connect(gain);gain.connect(context.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    oscillator.start(start);oscillator.stop(start+duration+.01);
  }
}
