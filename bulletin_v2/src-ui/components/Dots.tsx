interface DotsProps {
  total: number
  activeIndex: number
}

export function Dots({ total, activeIndex }: DotsProps){
  return (
    <div className="dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i === activeIndex ? 'active' : ''} />
      ))}
    </div>
  )
}
