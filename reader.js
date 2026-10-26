'use strict';
const ReaderRules = {
  link(token, page, cutoff) {
    const label = token.label || (page && this.name(page, cutoff)) || '';
    return {label, href: page && page.from <= cutoff && this.name(page, cutoff) ? page.file : null};
  },
  name(page, cutoff) { return page.names.filter(n => n.from <= cutoff).at(-1)?.text || ''; },
  pages(data, cutoff) { return data.pages.filter(p => p.from <= cutoff && this.name(p, cutoff)); },
  categoryPages(data, category, cutoff) {
    const pages = this.pages(data,cutoff).filter(p => p.category === category);
    // Book cards use reading order; all other directories sort the currently known names.
    return category === 'books' ? pages : pages.sort((a,b) => this.name(a,cutoff).localeCompare(this.name(b,cutoff),data.language));
  },
  nextPage(data, page, cutoff) {
    const pages = this.categoryPages(data,page.category,cutoff);
    const index = pages.findIndex(p => p.id === page.id);
    return index < 0 ? null : pages[index+1] || null;
  },
  navigationHref(data, page, cutoff) {
    const chapter = data.chapters.find(c => c.rank === cutoff);
    return page.file + (chapter ? '?chapter='+encodeURIComponent(chapter.id) : '');
  },
  gallery(data, cutoff) {
    const pages = new Map(data.pages.map(p => [p.id,p]));
    return (data.gallery || []).flatMap(image => {
      const variant = image.variants.find(v => {
        const page = pages.get(v.page);
        return v.from <= cutoff && (!v.page || (page && page.from <= cutoff && this.name(page,cutoff)));
      });
      if (!variant) return [];
      return [{id:image.id,file:image.file,asset:image.asset,from:variant.from,caption:variant.caption,
        title:variant.page ? this.name(pages.get(variant.page),cutoff) : ''}];
    });
  },
  nextImage(data, id, cutoff) {
    const images = this.gallery(data,cutoff), index = images.findIndex(i => i.id === id);
    return index < 0 ? null : images[index+1] || null;
  },
  blocks(page, cutoff) { return page.blocks.filter(b => b.from <= cutoff); },
  images(page, cutoff) { return page.images.filter(i => i.from <= cutoff); },
  keyFacts(page, cutoff) { return (page.key_facts || []).filter(b => b.from <= cutoff && (!b.until || cutoff < b.until)); },
  history(data, page, cutoff) {
    const story = this.blocks(page, cutoff).filter(b => b.kind === 'story');
    const selected = data.chapters.find(c => c.rank === cutoff);
    if (!selected || data.consolidate_previous_books === false) return {previous:[],current:story};
    const bookId = c => c.book_id || c.id.split('-')[0];
    const currentBook = bookId(selected), previous = [], current = [];
    const books = [...new Set(data.chapters.filter(c => c.rank <= cutoff).map(bookId))];
    for (const book of books) {
      const chapters = data.chapters.filter(c => bookId(c) === book);
      const ranks = new Set(chapters.map(c => c.rank));
      const blocks = story.filter(b => ranks.has(b.from));
      if (book === currentBook) { current.push(...blocks); continue; }
      const recap = (page.recaps || []).find(r => r.book === book);
      if (blocks.length || recap) previous.push({book,title:chapters[0].book,
        blocks:recap ? recap.blocks.filter(b => b.from <= cutoff) : blocks,
        from:Math.min(...ranks),through:Math.max(...ranks),replace_profile:!!recap?.replace_profile});
    }
    return {previous,current};
  },
  mainProfile(data, page, cutoff, history = this.history(data,page,cutoff)) {
    const opening = this.blocks(page,cutoff).filter(b => b.kind !== 'story');
    const snapshot = history.previous.filter(p => p.replace_profile).at(-1);
    const blocks = snapshot ? [...snapshot.blocks,...opening.filter(b => (b.evidence_from || b.from) > snapshot.through)] : [...opening];
    for (const earlier of history.previous) {
      if (snapshot && earlier.through <= snapshot.through) continue;
      blocks.push(...earlier.blocks.map(b => ({...b,kind:'history',heading:'History',main_section:true,profile_book:earlier.book})));
    }
    return blocks;
  },
  summaries(page, cutoff) { return (page.summaries || []).filter(c => c.from <= cutoff); },
  passages(blocks, maxWords = 150) {
    const result = [];
    const words = b => b.tokens.reduce((n,t) => n + (t.text || 'link').split(/\s+/).filter(Boolean).length,0);
    for (const block of blocks) {
      const previous = result.at(-1);
      if (previous && previous.from === block.from && previous.heading === block.heading && previous.kind === block.kind && words(previous) + words(block) <= maxWords) {
        previous.tokens.push({text:' '},...block.tokens);
        previous.refs = [...new Set([...previous.refs,...block.refs])];
      } else result.push({...block,tokens:[...block.tokens],refs:[...block.refs]});
    }
    return result;
  },
  cutoff(data, saved) { return data.chapters.find(c => c.id === saved)?.rank || 0; }
};
if (typeof module !== 'undefined') module.exports = ReaderRules;
if (typeof document !== 'undefined') (() => {
  const data = window.READER_DATA;
  if (!data) return;
  const en = {
    gallery:'Gallery',galleryIntro:'Illustrations available at your reading position.',emptyGallery:'No illustrations are available at this reading position.',
    backGallery:'Back to gallery',nextImage:'Next image',hiddenImage:'This illustration is not available at your reading position.',
    nextPage:'Next in',
    personality:'Personality',history:'History at first meeting',keyInformation:'At a glance',firstAppearance:'First appearance',previousHistory:'Earlier books',reviewedBackground:'Reviewed spoiler-free background',
    companion:'Reader wiki',explore:'Explore',about:'About this edition',yourReading:'YOUR READING',setPlace:'Reading position',
    controlHelp:'Explore only what you have already read.',savedLocally:'Your choice stays in this browser.',browse:'BROWSE THE WIKI',quietPromise:'The next discovery can wait.',
    footer:'An unofficial reading companion. Illustrations are artistic interpretations.',book:'Book',chapter:'Chapter',notStarted:'Not started',reset:'Reset reading position',
    heroA:'Explore the wiki.',heroB:'At your chapter.',edition:'READER WIKI',choose:'Choose your chapter to begin',protected:'Later material is hidden',
    begin:'Begin with chapter 1',startTitle:'Your story starts here.',startText:'Choose the last chapter you have finished. People, places and illustrations will appear as you encounter them.',
    featured:'People to follow',featuredHint:'A FEW FAMILIAR FACES',read:'Read their story',firstMeeting:'First meeting',search:'Find a page',searchPlaceholder:'Search known names…',
    people:'More people',other:'Explore the world',noMatches:'No known pages match your search.',later:'Later material stays hidden. Change your reading position when you are ready.',
    aboutTitle:'About this reader',aboutText:'This edition draws on the source-backed Markdown wiki. It organises its knowledge into a quieter, illustrated reading experience. Character development remains folded away until you choose to open it.',
    aboutMore:'Your reading position is stored only in this browser and is not synced between devices. Spoiler controls hide information in the interface; the complete exported site is publicly downloadable.',
    artNote:'Illustrations are noncanonical artistic interpretations. Their details are not additional evidence about the books.',
    futureTitle:'There is more to discover.',futureText:'This page is outside your selected reading position. Return after reading further, or change your chapter.',
    background:'At first meeting',appearance:'Appearance',story:'Their story',worldStory:'Accounts and discoveries',illustration:'Illustrated interpretation',
    noncanonical:'ARTISTIC INTERPRETATION',imageCaption:'Noncanonical illustration, shown only after its documented cutoff.',source:'Source notes',back:'Back to the reading companion',
    noStorage:'This browser cannot save your choice. It will last for this page only.',
    books:'Books',bookPage:'The book',chapterSummaries:'Chapter summaries',chapters:'Chapters',readBook:'Explore this book',
    bookHint:'READ CHAPTER BY CHAPTER',bookHelp:'Only summaries up to your reading position appear below.',available:'chapters in this edition',
    introduction:'Introduction',noSummary:'This chapter summary is awaiting a source-verified revision.', enlargeImage:'View larger image', closeImage:'Close image'
  };
  const nb = {
    gallery:'Galleri',galleryIntro:'Illustrasjoner tilgjengelige ved din leseposisjon.',emptyGallery:'Ingen illustrasjoner er tilgjengelige ved denne leseposisjonen.',
    backGallery:'Tilbake til galleriet',nextImage:'Neste bilde',hiddenImage:'Denne illustrasjonen er ikke tilgjengelig ved din leseposisjon.',
    nextPage:'Neste i',
    personality:'Personlighet',history:'Historie ved første møte',keyInformation:'Nøkkelinformasjon',firstAppearance:'Første opptreden',previousHistory:'Tidligere bøker',reviewedBackground:'Spoilervurdert bakgrunn',
    enlargeImage:'Vis større bilde', closeImage:'Lukk bilde',
    companion:'Leserwiki',explore:'Utforsk',about:'Om denne utgaven',yourReading:'DIN LESING',setPlace:'Leseposisjon',controlHelp:'Utforsk bare det du allerede har lest.',
    savedLocally:'Valget lagres i denne nettleseren.',browse:'UTFORSK WIKIEN',quietPromise:'Neste oppdagelse kan vente.',footer:'En uoffisiell lesefølgesvenn. Bildene er kunstneriske tolkninger.',
    book:'Bok',chapter:'Kapittel',notStarted:'Ikke startet',reset:'Nullstill leseposisjon',heroA:'Utforsk wikien.',heroB:'På ditt kapittel.',edition:'LESERWIKI',
    choose:'Velg kapittel for å begynne',protected:'Senere innhold er skjult',begin:'Begynn med kapittel 1',startTitle:'Historien din begynner her.',
    startText:'Velg det siste kapittelet du har lest ferdig. Personer, steder og bilder vises etter hvert som du møter dem.',featured:'Personer å følge',featuredHint:'NOEN KJENTE ANSIKTER',
    read:'Les historien',firstMeeting:'Første møte',search:'Finn en side',searchPlaceholder:'Søk etter kjente navn…',people:'Flere personer',other:'Utforsk verden',noMatches:'Ingen kjente sider passer søket.',
    later:'Senere innhold er skjult. Endre leseposisjonen når du er klar.',aboutTitle:'Om leserwikien',
    aboutText:'Denne utgaven bygger på den kildebelagte Markdown-wikien, med sammenhengende tekst og illustrasjoner. Personenes utvikling er minimert til du velger å åpne den.',
    aboutMore:'Leseposisjonen lagres bare i denne nettleseren og synkroniseres ikke mellom enheter. Spoilerkontrollen skjuler informasjon i visningen; hele nettstedet kan lastes ned.',
    artNote:'Bildene er kunstneriske tolkninger og gir ikke ytterligere kildebelegg om bøkene.',futureTitle:'Det er mer å oppdage.',futureText:'Denne siden ligger etter valgt leseposisjon. Kom tilbake når du har lest videre, eller endre kapittel.',
    background:'Ved første møte',appearance:'Utseende',story:'Personens historie',worldStory:'Beretninger og oppdagelser',illustration:'Illustrert tolkning',noncanonical:'KUNSTNERISK TOLKNING',
    imageCaption:'Illustrasjonen er ikke kanonisk og vises først etter sin dokumenterte kapittelgrense.',source:'Kildehenvisninger',back:'Tilbake til leserwikien',noStorage:'Nettleseren kan ikke lagre valget. Det gjelder bare på denne siden.',
    books:'Bøker',bookPage:'Boken',chapterSummaries:'Kapitteloppsummeringer',chapters:'Kapitler',readBook:'Utforsk boken',bookHint:'LES KAPITTEL FOR KAPITTEL',
    bookHelp:'Bare oppsummeringer frem til leseposisjonen vises nedenfor.',available:'kapitler i denne utgaven',introduction:'Introduksjon',noSummary:'Denne kapitteloppsummeringen venter på en kildeverifisert revisjon.'
  };
  const nn = {...nb,galleryIntro:'Illustrasjonar tilgjengelege ved leseposisjonen din.',emptyGallery:'Ingen illustrasjonar er tilgjengelege ved denne leseposisjonen.',nextImage:'Neste bilete',hiddenImage:'Denne illustrasjonen er ikkje tilgjengeleg ved leseposisjonen din.',personality:'Personlegdom',history:'Historie ved første møte',keyInformation:'Nøkkelinformasjon',firstAppearance:'Første framkomst',previousHistory:'Tidlegare bøker',reviewedBackground:'Spoilervurdert bakgrunn',enlargeImage:'Vis større bilete',closeImage:'Lukk bilete',setPlace:'Leseposisjon',controlHelp:'Utforsk berre det du allereie har lese.',savedLocally:'Valet vert lagra i denne nettlesaren.',
    notStarted:'Ikkje byrja',reset:'Nullstill leseposisjonen',begin:'Byrj med kapittel 1',startTitle:'Historia di byrjar her.',startText:'Vel det siste kapittelet du har lese ferdig. Personar, stader og bilete vert viste etter kvart som du møter dei.',
    choose:'Vel kapittel for å byrje',protected:'Seinare innhald er skjult',later:'Seinare innhald er skjult. Endre leseposisjonen når du er klar.',
    appearance:'Utsjånad',source:'Kjeldetilvisingar',imageCaption:'Illustrasjonen er ikkje kanonisk og vert først vist etter den dokumenterte kapittelgrensa.',
    artNote:'Bileta er kunstnarlege tolkingar og gjev ikkje ytterlegare kjeldebelegg om bøkene.',footer:'Ein uoffisiell lesefølgjesvein. Bileta er kunstnarlege tolkingar.',
    bookPage:'Boka',readBook:'Utforsk boka',chapterSummaries:'Kapitteloppsummeringar',bookHelp:'Berre oppsummeringar fram til leseposisjonen vert viste nedanfor.',
    available:'kapittel i denne utgåva',introduction:'Innleiing',noSummary:'Denne kapitteloppsummeringa ventar på ein kjeldeverifisert revisjon.'};
  const t = {...en,...(data.language === 'nn' ? nn : data.language === 'nb' ? nb : {})};
  document.querySelectorAll('[data-ui]').forEach(el => { el.textContent = t[el.dataset.ui] || el.textContent; });
  const app = document.getElementById('app');
  let cutoff = 0, query = '', storageOK = true;
  try { cutoff = ReaderRules.cutoff(data, localStorage.getItem(data.storageKey)); } catch { storageOK = false; }
  const linkedCutoff = ReaderRules.cutoff(data,new URLSearchParams(window.location.search).get('chapter'));
  if (linkedCutoff) {
    cutoff = linkedCutoff;
    try { localStorage.setItem(data.storageKey,data.chapters.find(c => c.rank === cutoff).id); } catch { storageOK = false; }
  }
  const lookup = new Map(data.pages.map(p => [p.id,p]));
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key,value] of Object.entries(attrs)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
      else if (value !== null && value !== false) node.setAttribute(key,value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }
  function name(page) { return ReaderRules.name(page,cutoff); }
  function chapterLabel(rank) {
    const c = data.chapters.find(c => c.rank === rank);
    return c ? `${c.book} · ${t.chapter.toLowerCase()} ${c.number}` : '';
  }
  function save(rank) {
    cutoff = rank;
    // Remove a stale incoming position when the reader explicitly changes it.
    const url = new URL(window.location.href); url.searchParams.delete('chapter');
    try { window.history.replaceState(null,'',url); } catch { /* file previews may disallow history updates */ }
    try { if (rank) localStorage.setItem(data.storageKey,data.chapters.find(c => c.rank === rank).id); else localStorage.removeItem(data.storageKey); }
    catch { storageOK = false; }
    render();
  }
  function controls() {
    const holder = document.getElementById('controls');
    holder.hidden = false; holder.replaceChildren();
    const book = el('select',{id:'book-choice','aria-label':t.book});
    const books = [...new Set(data.chapters.map(c => c.book))];
    books.forEach(b => book.append(el('option',{value:b},b)));
    book.value = data.chapters.find(c => c.rank === cutoff)?.book || books[0];
    const chapter = el('select',{id:'chapter-choice','aria-label':t.chapter});
    function fill() {
      chapter.replaceChildren(el('option',{value:0},t.notStarted));
      data.chapters.filter(c => c.book === book.value).forEach(c => chapter.append(el('option',{value:c.rank},`${t.chapter} ${c.number}`)));
      chapter.value = String(cutoff);
      if (!chapter.value) chapter.value = '0';
    }
    fill();
    book.addEventListener('change',() => { fill(); chapter.focus(); });
    chapter.addEventListener('change',() => save(Number(chapter.value)));
    holder.append(el('div',{},el('label',{for:'book-choice'},t.book),book),el('div',{},el('label',{for:'chapter-choice'},t.chapter),chapter),
      el('button',{class:'reset',type:'button',onclick:() => save(0)},t.reset));
    document.querySelector('.privacy-note').textContent = storageOK ? t.savedLocally : t.noStorage;
  }
  function tokens(block) {
    return block.tokens.map(token => {
      if (token.text !== undefined) return token.text;
      const page = lookup.get(token.page);
      const link = ReaderRules.link(token, page, cutoff);
      return link.href ? el('a',{href:link.href},link.label) : link.label;
    });
  }
  function evidence(blocks) {
    const refs = [...new Set(blocks.flatMap(b => b.refs).map(id => {
      const m = id.match(/f-(b\d+)-(c\d+)-/i);
      return m ? `${m[1]}-${m[2]}`.toUpperCase() : '';
    }))].map(id => data.chapters.find(c => c.id === id)).filter(c => c && c.rank <= cutoff);
    return el('details',{class:'evidence'},el('summary',{},t.source),refs.map(c => el('p',{},chapterLabel(c.rank))),blocks.some(b => b.reviewed_early) ? el('p',{},t.reviewedBackground) : null);
  }
  function prose(blocks, lead = false) {
    if (!blocks.length) return [];
    return [...ReaderRules.passages(blocks).map(b => el('p',{class:lead?'page-description':null},tokens(b))),evidence(blocks)];
  }
  let imageViewer = null;
  function closeImageViewer() {
    if (!imageViewer) return;
    const dialog = imageViewer;
    imageViewer = null;
    dialog.close();
    dialog.remove();
  }
  function openImage(image, page) {
    if (page.from > cutoff || image.from > cutoff || !name(page)) return;
    closeImageViewer();
    const caption = el('p',{id:'image-viewer-caption'},t.noncanonical+' · '+name(page)+' · '+chapterLabel(image.from));
    const dialog = el('dialog',{class:'image-viewer','aria-label':t.illustration,'aria-describedby':'image-viewer-caption'},
      el('button',{type:'button',class:'image-viewer-close',autofocus:true,onclick:closeImageViewer},t.closeImage+' ×'),
      el('img',{src:image.file,alt:`${name(page)} — ${t.illustration.toLowerCase()}`,decoding:'async'}),caption);
    dialog.addEventListener('click',event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeImageViewer();
    });
    dialog.addEventListener('close',() => { if (imageViewer === dialog) imageViewer = null; dialog.remove(); });
    document.body.append(dialog);
    imageViewer = dialog;
    dialog.showModal();
  }
  function figure(image, page, primary = false) {
    const details = el('details',{class:'evidence'},el('summary',{},t.source),el('p',{},chapterLabel(image.from)),el('p',{},t.artNote));
    return el('figure',{'data-image-from':image.from,class:primary?'primary-portrait':null},
      el('button',{type:'button',class:'image-expand','aria-label':`${t.enlargeImage}: ${name(page)}`,onclick:() => openImage(image,page)},
        el('img',{src:image.file,alt:`${name(page)} — ${t.illustration.toLowerCase()}`,loading:primary?'eager':'lazy',decoding:'async'}),
        el('span',{class:'image-expand-hint','aria-hidden':'true'},t.enlargeImage+' ↗')),
      el('figcaption',{},el('span',{class:'badge'},t.noncanonical),el('br'),image.caption || t.imageCaption,details));
  }
  function nav(pages) {
    const node = document.getElementById('category-nav'); node.replaceChildren();
    for (const [key,label] of Object.entries(data.categories)) {
      const count = pages.filter(p => p.category === key).length;
      if (count) node.append(el('a',{href:`index.html#${key}`,class:'category-link'},el('span',{},label),el('span',{},count)));
    }
  }
  function card(page) {
    const image = ReaderRules.images(page,cutoff).find(i => i.role === 'primary' && !i.spoiler);
    const preview = ReaderRules.blocks(page,cutoff).find(b => b.kind === 'introduction');
    const previewText = preview ? preview.tokens.map(x => x.text !== undefined ? x.text : x.label || name(lookup.get(x.page))).join('') : '';
    const picture = image ? el('div',{class:'card-picture'},el('img',{src:image.file,alt:'',loading:'lazy'})) : el('div',{class:'card-picture placeholder','aria-hidden':'true'},name(page).slice(0,1));
    return el('a',{href:page.file,class:'person-card','data-page-id':page.id},picture,
      el('div',{class:'card-copy'},el('h3',{},name(page)),el('p',{},previewText.length > 145 ? previewText.slice(0,142)+'…' : previewText),el('span',{class:'read-link'},t.read+' ↗')));
  }
  function landing(pages) {
    document.title = `${data.title} · ${t.companion}`;
    app.append(el('section',{class:'hero'},el('span',{class:'eyebrow'},t.edition),el('h1',{},t.heroA,el('br'),el('em',{},t.heroB)),
      el('p',{class:'intro'},data.description),el('div',{class:'hero-bottom'},el('span',{class:'status-pill'},cutoff?chapterLabel(cutoff):t.choose),
        cutoff ? el('span',{class:'tiny'},t.protected) : el('button',{class:'primary',type:'button',onclick:() => save(1)},t.begin))));
    if (!cutoff) app.append(el('section',{class:'empty-state'},el('h2',{},t.startTitle),el('p',{},t.startText)));
    const books = pages.filter(p => p.type === 'book');
    if (books.length) app.append(el('section',{id:'books'},el('div',{class:'section-heading'},el('h2',{},t.books),el('span',{class:'eyebrow'},t.bookHint)),
      books.map(p => el('a',{href:p.file,class:'book-card'},el('span',{class:'book-number','aria-hidden':'true'},p.book_id.slice(1)),
        el('div',{},el('span',{class:'eyebrow'},t.book+' '+Number(p.book_id.slice(1))),el('h3',{},name(p)),el('span',{class:'tiny'},t.chapterSummaries)),el('span',{class:'book-arrow','aria-hidden':'true'},'↗')))));
    const featured = pages.filter(p => p.featured);
    if (featured.length) app.append(el('section',{},el('div',{class:'section-heading'},el('h2',{},t.featured),el('span',{class:'eyebrow'},t.featuredHint)),el('div',{class:'card-grid'},featured.map(card))));
    if (pages.length) {
      const input = el('input',{id:'directory-search',type:'search',placeholder:t.searchPlaceholder,autocomplete:'off'}); input.value = query;
      const results = el('div',{id:'directories'});
      const update = () => {
        query = input.value; results.replaceChildren();
        const filtered = pages.filter(p => name(p).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        if (!filtered.length) results.append(el('p',{class:'tiny'},t.noMatches));
        for (const [key,label] of Object.entries(data.categories)) {
          if (key === 'books') continue;
          const members = ReaderRules.categoryPages(data,key,cutoff).filter(p => filtered.includes(p));
          if (!members.length) continue;
          const list = el('ul',{class:'directory-list'},members.map(p => el('li',{},el('a',{href:p.file,'data-page-id':p.id},name(p)))));
          const section = el('section',{id:key,class:'directory-group'});
          if (key === 'characters') {
            const disclosure = el('details',{},el('summary',{},`${label} · ${members.length}`),list);
            if (query) disclosure.open = true;
            section.append(disclosure);
          } else section.append(el('div',{class:'section-heading'},el('h2',{},label)),list);
          results.append(section);
        }
      };
      input.addEventListener('input',update);
      app.append(el('div',{class:'directory-tools'},el('label',{for:'directory-search'},t.search),input),results); update();
    }
    app.append(el('section',{id:'about',class:'about-box'},el('h2',{},t.aboutTitle),el('p',{},t.aboutText),el('p',{},t.aboutMore),el('p',{},t.artNote)));
  }
  function article(page) {
    if (!page || page.from > cutoff || !name(page)) {
      document.title = `${data.title} · ${t.companion}`;
      app.append(el('section',{class:'empty-state'},el('h1',{},t.futureTitle),el('p',{},t.futureText),el('a',{href:'index.html'},t.back))); return;
    }
    document.title = `${name(page)} · ${data.title}`;
    const blocks = ReaderRules.blocks(page,cutoff), images = ReaderRules.images(page,cutoff);
    app.append(el('div',{class:'breadcrumbs'},el('a',{href:'index.html'},t.explore),' / ',data.categories[page.category]),
      el('header',{class:'article-heading'},el('span',{class:'eyebrow'},data.categories[page.category]),el('h1',{},name(page))));
    const next = ReaderRules.nextPage(data,page,cutoff);
    if (next) app.append(el('nav',{class:'article-next','aria-label':`${t.nextPage} ${data.categories[page.category]}`},
      el('a',{href:ReaderRules.navigationHref(data,next,cutoff),rel:'next'},el('span',{class:'tiny'},`${t.nextPage} ${data.categories[page.category]}: `),
        el('span',{},name(next)),el('span',{'aria-hidden':'true'},' →'))));
    if (page.type === 'book') { bookArticle(page); return; }
    const lead = images.find(i => i.role === 'primary' && !i.spoiler);
    const facts = ReaderRules.keyFacts(page,cutoff);
    const history = ReaderRules.history(data,page,cutoff);
    const mainBlocks = ReaderRules.mainProfile(data,page,cutoff,history);
    const usedImages = new Set(lead ? [lead.file] : []);
    const hasBox = page.category === 'characters' || lead || facts.length;
    const top = el('div',{class:'profile-top'+(hasBox?'':' no-image')});
    const intro = el('div',{class:'prose'});
    intro.append(...prose(mainBlocks.filter(b => b.kind === 'introduction'),true));
    const mainGroups = new Map();
    for (const block of mainBlocks.filter(b => b.kind !== 'introduction')) {
      const heading = block.main_section ? block.heading : t[block.kind] || block.heading;
      if (!mainGroups.has(heading)) mainGroups.set(heading,[]);
      mainGroups.get(heading).push(block);
    }
    const pastImages = images.filter(i => !usedImages.has(i.file) && history.previous.some(p => i.from >= p.from && i.from <= p.through));
    const mainImages = new Map();
    const refRank = group => Math.max(0,...group.flatMap(b => b.refs).map(ref => {
      const m = ref.match(/f-(b\d+)-(c\d+)-/i);
      return m ? data.chapters.find(c => c.id === (m[1]+'-'+m[2]).toUpperCase())?.rank || 0 : 0;
    }));
    for (const image of pastImages) {
      const matching = [...mainGroups].find(([,group]) => group.some(b => b.kind === 'history') && refRank(group) >= image.from);
      const heading = matching?.[0] || [...mainGroups.keys()].at(-1) || t.history;
      if (!mainGroups.has(heading)) mainGroups.set(heading,[]);
      if (!mainImages.has(heading)) mainImages.set(heading,[]);
      mainImages.get(heading).push(image);usedImages.add(image.file);
    }
    for (const [heading,group] of mainGroups) {
      const section = el('section',{class:'main-biography-section','data-history-book':group.find(b => b.profile_book)?.profile_book || null},
        el('h2',{},heading),...prose(group),...(mainImages.get(heading)||[]).map(i => figure(i,page)));
      intro.append(section);
    }
    top.append(intro);
    if (hasBox) {
      const fields = el('dl',{class:'key-facts'});
      fields.append(el('dt',{},t.firstAppearance),el('dd',{},chapterLabel(page.from)));
      const labels = new Map();
      for (const fact of facts) {
        if (!labels.has(fact.label)) labels.set(fact.label,[]);
        labels.get(fact.label).push(fact);
      }
      for (const [label,rows] of labels) fields.append(el('dt',{},label),el('dd',{},
        rows.length === 1 ? tokens(rows[0]) : el('ul',{},rows.map(row => el('li',{},tokens(row))))));
      const box = el('aside',{class:'profile-box','aria-label':t.keyInformation},el('h2',{},name(page)));
      if (lead) box.append(figure(lead,page,true));
      box.append(fields); if (facts.length) box.append(evidence(facts));
      top.append(box);
    }
    app.append(top);
    const story = history.current;
    const groups = new Map();
    story.forEach(b => { const key = b.from+'|'+b.heading; if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(b); });
    // Additional images follow their explanation inside its disclosure, never as an unguarded gallery.
    const sectionImages = new Map();
    for (const image of images.filter(i => !usedImages.has(i.file))) {
      const matching = [...groups].filter(([,bs]) => Math.max(...bs.map(b => b.from)) >= image.from);
      const heading = matching[0]?.[0] || [...groups.keys()].at(-1) || t.illustration;
      if (!groups.has(heading)) groups.set(heading,[]);
      if (!sectionImages.has(heading)) sectionImages.set(heading,[]);
      sectionImages.get(heading).push(image);
    }
    if (groups.size) app.append(el('h2',{class:'story-title'},page.category==='characters'?t.story:t.worldStory));
    for (const [heading,group] of groups) {
      const ranks = [...group.map(b => b.from),...(sectionImages.get(heading)||[]).map(i => i.from)];
      const title = group[0]?.heading || t.illustration;
      const summary = el('summary',{},title,el('small',{},chapterLabel(Math.max(...ranks))));
      const content = el('div',{class:'prose'},prose(group), (sectionImages.get(heading)||[]).map(i => figure(i,page)));
      app.append(el('details',{class:'story-section'},summary,content));
    }
    app.append(el('p',{class:'later-note'},t.later),el('a',{href:'index.html',class:'back-link'},'← '+t.back));
  }
  function bookArticle(page) {
    app.append(el('div',{class:'book-meta'},el('span',{},t.book+' '+Number(page.book_id.slice(1))),
      el('span',{},page.summaries.length+' '+t.available)));
    app.append(el('div',{class:'prose book-intro'},prose(ReaderRules.blocks(page,cutoff),true)),
      el('h2',{class:'story-title'},t.chapterSummaries),el('p',{class:'tiny'},t.bookHelp));
    const summaries = ReaderRules.summaries(page,cutoff);
    const batches = new Map();
    for (const chapter of summaries) {
      const batch = Math.floor(page.summaries.indexOf(chapter)/5);
      if (!batches.has(batch)) batches.set(batch,[]);
      batches.get(batch).push(chapter);
    }
    for (const chapters of batches.values()) {
      const section = el('section',{class:'chapter-batch'},el('h2',{},t.chapters+' '+chapters[0].number+'–'+chapters.at(-1).number));
      for (const chapter of chapters) section.append(el('details',{class:'story-section chapter-summary','data-chapter-id':chapter.id},
        el('summary',{},chapter.heading),el('div',{class:'prose'},chapter.blocks.length?prose(chapter.blocks):el('p',{},t.noSummary))));
      app.append(section);
    }
    app.append(el('p',{class:'later-note'},t.later),el('a',{href:'index.html',class:'back-link'},'← '+t.back));
  }
  function galleryPage(id) {
    const images = ReaderRules.gallery(data,cutoff);
    const galleryHref = ReaderRules.navigationHref(data,{file:'gallery.html'},cutoff);
    document.title = `${t.gallery} · ${data.title}`;
    if (id === 'gallery') {
      app.append(el('header',{class:'article-heading'},el('h1',{},t.gallery),el('p',{},t.galleryIntro)));
      if (!images.length) { app.append(el('p',{class:'empty-state'},t.emptyGallery)); return; }
      app.append(el('div',{class:'gallery-grid'},images.map(image =>
        el('a',{class:'gallery-card',href:ReaderRules.navigationHref(data,image,cutoff)},
          el('figure',{},el('img',{src:image.asset,alt:image.caption,loading:'lazy',decoding:'async'}),
            el('figcaption',{},el('strong',{},image.title || t.illustration),el('p',{},image.caption)))))));
      return;
    }
    const image = images.find(i => i.id === id);
    app.append(el('a',{href:galleryHref,class:'back-link'},'← '+t.backGallery));
    if (!image) { app.append(el('section',{class:'empty-state'},el('h1',{},t.hiddenImage))); return; }
    document.title = `${image.title || t.illustration} · ${t.gallery} · ${data.title}`;
    app.append(el('header',{class:'article-heading'},el('h1',{},image.title || t.illustration)));
    const next = ReaderRules.nextImage(data,id,cutoff);
    if (next) app.append(el('nav',{class:'article-next','aria-label':t.nextImage},
      el('a',{href:ReaderRules.navigationHref(data,next,cutoff),rel:'next'},`${t.nextImage}: ${next.title || t.illustration} →`)));
    app.append(el('figure',{class:'gallery-full'},el('img',{src:image.asset,alt:image.caption,decoding:'async'}),
      el('figcaption',{},el('span',{class:'badge'},t.noncanonical),el('p',{},image.caption),el('p',{class:'tiny'},chapterLabel(image.from)))));
  }
  function render() {
    // Replace, rather than merely hide, stale content when the reader moves backwards.
    closeImageViewer(); app.replaceChildren(); controls(); const pages = ReaderRules.pages(data,cutoff); nav(pages);
    document.querySelectorAll('[data-gallery-link]').forEach(link => { link.href = ReaderRules.navigationHref(data,{file:'gallery.html'},cutoff); });
    const pageId = document.body.dataset.page;
    if (pageId === 'gallery' || pageId.startsWith('image-')) galleryPage(pageId);
    else if (pageId === 'index') landing(pages); else article(lookup.get(pageId));
  }
  window.addEventListener('storage',event => { if (event.key === data.storageKey) { cutoff = ReaderRules.cutoff(data,event.newValue); render(); } });
  render();
})();
