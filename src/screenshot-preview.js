window.screenshotPreview.frame().then(value=>{window.applyPreviewTheme(value.theme||{});document.querySelector('#image').src=value.image;document.querySelector('#description').textContent=value.name+' · '+value.width+' × '+value.height;}).catch(error=>document.querySelector('#status').textContent=error.message);
document.querySelector('#close').onclick=()=>window.screenshotPreview.close();document.addEventListener('keydown',event=>{if(event.key==='Escape')window.screenshotPreview.close();});
document.querySelector('#zoom').onclick=event=>{const actual=document.body.classList.toggle('actual');event.target.textContent=actual?'Вписать в окно':'Масштаб 100%';};
document.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{try{await window.screenshotPreview.action(button.dataset.action);document.querySelector('#status').textContent=button.dataset.action==='copy'?'Картинка скопирована':'Открыта папка снимка';}catch(error){document.querySelector('#status').textContent=error.message;}});

window.screenshotPreview.onTheme?.(window.applyPreviewTheme);
