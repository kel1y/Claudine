import { createUniqueId, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16">
            <g transform="translate(64.6154 0)">
              <path
                opacity="0.7"
                d="M55.3846 18H73.8462V36.4286H55.3846V18ZM55.3846 54.8571H73.8462V110.143H55.3846V54.8571Z"
                fill="currentColor"
              />
              <path
                opacity="0.7"
                transform="translate(92.3077 0)"
                d="M55.3846 36.4286H18.4615V110.143H0V18H55.3846V36.4286ZM73.8462 110.143H55.3846V36.4286H73.8462V110.143Z"
                fill="currentColor"
              />
              <path
                opacity="0.7"
                transform="translate(184.6154 0)"
                d="M73.8462 36.4286H18.4615V91.7143H73.8462V110.143H0V18H73.8462V36.4286Z"
                fill="currentColor"
              />
              <path
                opacity="0.7"
                transform="translate(276.9231 0)"
                d="M55.3846 36.4286H18.4615V91.7143H55.3846V36.4286ZM73.8462 110.143H0V18H73.8462V110.143Z"
                fill="currentColor"
              />
              <path
                opacity="0.7"
                transform="translate(369.2308 0)"
                d="M55.3846 36.8571H18.4615V92.1429H55.3846V36.8571ZM73.8462 110.571H0V18.4286H55.3846V0H73.8462V110.571Z"
                fill="currentColor"
              />
              <path
                opacity="0.7"
                transform="translate(461.5385 0)"
                d="M73.8462 73.2857H18.4615V91.7143H73.8462V110.143H0V18H73.8462V73.2857ZM18.4615 54.8571H55.3846V36.4286H18.4615V54.8571Z"
                fill="currentColor"
              />
            </g>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
