import { Subject } from 'rxjs'
import { injectable } from 'tsyringe'

@injectable()
export class EventBusService {
  private event$ = new Subject<{ type: string; payload: any }>()

  emit(type: string, payload: any) {
    this.event$.next({ type, payload })
  }

  on(type: string, callback: (payload: any) => void) {
    this.event$.subscribe((event) => {
      if (event.type === type) callback(event.payload)
    })
  }
}
