// ===== DRAG-TO-SCROLL ФУНКЦИОНАЛЬНОСТЬ =====
// Позволяет перетаскивать sticky divs для скролла страницы

export class DragToScroll {
  constructor() {
    this.isDragging = false;
    this.startY = 0;
    this.scrollTop = 0;
    this.draggedElement = null;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
  }

  initElement(element) {
    if (!element) return;

    // Указываем, что элемент можно перетаскивать
    element.style.cursor = "grab";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";
    element.style.touchAction = "manipulation";

    // Mouse events
    element.addEventListener("mousedown", this.onMouseDown);

    // Touch events
    element.addEventListener("touchstart", this.onTouchStart, {
      passive: true,
    });
  }

  onMouseDown(e) {
    if (e.button !== 0) return; // Только левая кнопка мыши

    // Если клик был на интерактивном элементе (кнопка, ссылка, инпут и т.д.), игнорируем
    const target = e.target;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "A" ||
      target.tagName === "INPUT" ||
      target.closest("button") ||
      target.closest("a") ||
      target.closest("input") ||
      target.closest(".match-row") ||
      target.closest(".event") ||
      target.closest(".my-bets-item")
    ) {
      return;
    }

    // Предотвращаем выделение текста и другие стандартные действия
    e.preventDefault();

    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startY = e.clientY;
    this.scrollTop = window.scrollY;

    this.draggedElement.style.cursor = "grabbing";

    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  onMouseMove = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    const delta = e.clientY - this.startY;
    window.scrollTo(0, this.scrollTop - delta);
  };

  onMouseUp = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    this.isDragging = false;
    if (this.draggedElement) {
      this.draggedElement.style.cursor = "grab";
    }

    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
  };

  onTouchStart(e) {
    if (e.touches.length !== 1) return;

    // Если touch был на интерактивном элементе, игнорируем
    const target = e.target;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "A" ||
      target.tagName === "INPUT" ||
      target.closest("button") ||
      target.closest("a") ||
      target.closest("input")
    ) {
      return;
    }

    // Предотвращаем стандартное поведение для touch
    e.preventDefault();

    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startY = e.touches[0].clientY;
    this.scrollTop = window.scrollY;

    document.addEventListener("touchmove", this.onTouchMove, {
      passive: false,
    });
    document.addEventListener("touchend", this.onTouchEnd);
  }

  onTouchMove = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    const delta = e.touches[0].clientY - this.startY;
    window.scrollTo(0, this.scrollTop - delta);
  };

  onTouchEnd = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    this.isDragging = false;

    document.removeEventListener("touchmove", this.onTouchMove);
    document.removeEventListener("touchend", this.onTouchEnd);
  };
}

// Инициализируем drag-to-scroll при загрузке страницы
export const dragToScroll = new DragToScroll();

// Инициализация элементов для перетаскивания
export function initDragToScroll() {
  // Ищем все sticky заголовки (но исключаем roundsFilterContainer)
  const stickyHeaders = document.querySelectorAll(
    'div[style*="position: sticky"]:not(#roundsFilterContainer)'
  );
  stickyHeaders.forEach((header) => {
    dragToScroll.initElement(header);
  });

  // Инициализируем drag-to-scroll для левой колонки
  const leftColumn = document.getElementById("leftColumn");
  if (leftColumn) {
    dragToScroll.initElement(leftColumn);
  }
}

// Класс для горизонтального drag-to-scroll (для туров)
export class HorizontalDragScroll {
  constructor() {
    this.isDragging = false;
    this.startX = 0;
    this.scrollLeft = 0;
    this.draggedElement = null;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onWheel = this.onWheel.bind(this);
  }

  initElement(element) {
    if (!element) return;

    element.style.cursor = "grab";
    element.style.userSelect = "none";
    element.style.webkitUserSelect = "none";
    element.style.touchAction = "manipulation";

    element.addEventListener("mousedown", this.onMouseDown);
    element.addEventListener("touchstart", this.onTouchStart, {
      passive: true,
    });
    element.addEventListener("wheel", this.onWheel, { passive: false });
  }

  onWheel(e) {
    // Предотвращаем вертикальную прокрутку страницы
    e.preventDefault();
    
    // Прокручиваем горизонтально
    e.currentTarget.scrollLeft += e.deltaY;
  }

  onMouseDown(e) {
    // НЕ игнорируем клики на кнопках - это важно!
    // Мы хотим перетаскивать ЗА кнопки

    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startX = e.clientX;
    this.scrollLeft = this.draggedElement.scrollLeft;

    this.draggedElement.style.cursor = "grabbing";

    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  onMouseMove = (e) => {
    if (!this.isDragging) return;

    e.preventDefault();

    const delta = e.clientX - this.startX;
    this.draggedElement.scrollLeft = this.scrollLeft - delta;
  };

  onMouseUp = (e) => {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.draggedElement.style.cursor = "grab";

    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
  };

  onTouchStart(e) {
    this.isDragging = true;
    this.draggedElement = e.currentTarget;
    this.startX = e.touches[0].clientX;
    this.scrollLeft = this.draggedElement.scrollLeft;
  }

  onTouchMove = (e) => {
    if (!this.isDragging) return;

    const delta = e.touches[0].clientX - this.startX;
    this.draggedElement.scrollLeft = this.scrollLeft - delta;
  };

  onTouchEnd = (e) => {
    this.isDragging = false;
  };
}

// Инициализация горизонтального drag-to-scroll для туров
export function initHorizontalDragScroll() {
  const horizontalDragScroll = new HorizontalDragScroll();
  const roundsContainer = document.getElementById("roundsFilterContainer");
  if (roundsContainer) {
    horizontalDragScroll.initElement(roundsContainer);
  }
  
  // Инициализируем также для tournamentRoundsFilter
  const tournamentRoundsFilter = document.getElementById("tournamentRoundsFilter");
  if (tournamentRoundsFilter) {
    horizontalDragScroll.initElement(tournamentRoundsFilter);
  }
}

// ===== ОБРАБОТКА TOUCH СОБЫТИЙ ДЛЯ СКРОЛЛА СТРАНИЦЫ =====

export function initPageScrollOnHeaders() {
  const elements = [
    document.querySelector('.tournaments-header'),
    document.querySelector('.matches-container'),
    document.querySelector('.my-bets-title')
  ];

  elements.forEach(element => {
    if (!element) return;

    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let isDragging = false;
    let momentumAnimation = null;

    element.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      lastY = startY;
      lastTime = Date.now();
      velocity = 0;
      isDragging = true;
      
      // Останавливаем предыдущую анимацию инерции
      if (momentumAnimation) {
        cancelAnimationFrame(momentumAnimation);
        momentumAnimation = null;
      }
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
      if (!isDragging) return;

      // Предотвращаем стандартный скролл контейнера
      e.preventDefault();
      e.stopPropagation();

      const currentY = e.touches[0].clientY;
      const currentTime = Date.now();
      const deltaY = lastY - currentY;
      const deltaTime = currentTime - lastTime;

      // Вычисляем скорость (пиксели в миллисекунду)
      if (deltaTime > 0) {
        velocity = deltaY / deltaTime;
      }

      // Скроллим страницу
      window.scrollBy(0, deltaY);
      
      lastY = currentY;
      lastTime = currentTime;
    }, { passive: false });

    element.addEventListener('touchend', () => {
      isDragging = false;
      
      // Запускаем инерционный скролл если скорость достаточная
      if (Math.abs(velocity) > 0.1) {
        startMomentumScroll(velocity);
      }
    }, { passive: false });

    // Инерционный скролл
    function startMomentumScroll(initialVelocity) {
      let currentVelocity = initialVelocity;
      const deceleration = 0.95; // Коэффициент замедления (0.95 = 5% замедление за кадр)
      const minVelocity = 0.1; // Минимальная скорость для продолжения анимации

      function animate() {
        if (Math.abs(currentVelocity) < minVelocity) {
          momentumAnimation = null;
          return;
        }

        // Скроллим с текущей скоростью
        window.scrollBy(0, currentVelocity * 16); // 16ms ≈ 1 кадр при 60fps
        
        // Замедляем
        currentVelocity *= deceleration;

        // Продолжаем анимацию
        momentumAnimation = requestAnimationFrame(animate);
      }

      animate();
    }
  });
}

// Инициализируем при загрузке
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initDragToScroll();
    initHorizontalDragScroll();
    initPageScrollOnHeaders();
  });
} else {
  initDragToScroll();
  initHorizontalDragScroll();
  initPageScrollOnHeaders();
}
