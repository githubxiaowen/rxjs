import { isArray } from './util/isArray';
import { isObject } from './util/isObject';
import { isFunction } from './util/isFunction';
import { UnsubscriptionError } from './util/UnsubscriptionError';
import { SubscriptionLike, TeardownLogic } from './types';

/**
 * Represents a disposable resource, such as the execution of an Observable. A
 * Subscription has one important method, `unsubscribe`, that takes no argument
 * and just disposes the resource held by the subscription.
 *
 * Additionally, subscriptions may be grouped together through the `add()`
 * method, which will attach a child Subscription to the current Subscription.
 * When a Subscription is unsubscribed, all its children (and its grandchildren)
 * will be unsubscribed as well.
 *
 * @class Subscription
 */
export class Subscription implements SubscriptionLike {
  /** @nocollapse */
  public static EMPTY: Subscription = (function(empty: any) {
    empty.closed = true;
    return empty;
  }(new Subscription()));

  /**
   * A flag to indicate whether this Subscription has already been unsubscribed.
   * @type {boolean}
   */
  public closed: boolean = false;

  /** @internal */
  protected _parents: Subscription[] = null;
  /** @internal */
  private _subscriptions: SubscriptionLike[] = null;

  /**
   * @param {function(): void} [unsubscribe] A function describing how to
   * perform the disposal of resources when the `unsubscribe` method is called.
   */
  constructor(unsubscribe?: () => void) {
    if (unsubscribe) {
      (<any> this)._unsubscribe = unsubscribe;
    }
  }

  /**
   * Disposes the resources held by the subscription. May, for instance, cancel
   * an ongoing Observable execution or cancel any other type of work that
   * started when the Subscription was created.
   * @return {void}
   */
  unsubscribe(): void {
    let errors: any[];

    if (this.closed) {
      return;
    }

    let { _parents, _unsubscribe, _subscriptions } = (<any> this);

    this.closed = true;
    this._parents = null;
    // null out _subscriptions first so any child subscriptions that attempt
    // to remove themselves from this subscription will noop
    this._subscriptions = null;

    if (_parents !== null) {
      for (let index = 0; index < _parents.length; ++index) {
        const parent = _parents[index];
        parent.remove(this);
      }
    }

    if (isFunction(_unsubscribe)) {
      try {
        _unsubscribe.call(this);
      } catch (e) {
        errors = e instanceof UnsubscriptionError ? flattenUnsubscriptionErrors(e.errors) : [e];
      }
    }

    if (isArray(_subscriptions)) {
      let index = -1;
      let len = _subscriptions.length;

      while (++index < len) {
        const sub = _subscriptions[index];
        if (isObject(sub)) {
          try {
            sub.unsubscribe();
          } catch (e) {
            errors = errors || [];
            if (e instanceof UnsubscriptionError) {
              errors = errors.concat(flattenUnsubscriptionErrors(e.errors));
            } else {
              errors.push(e);
            }
          }
        }
      }
    }

    if (errors) {
      throw new UnsubscriptionError(errors);
    }
  }

  /**
   * Adds a tear down to be called during the unsubscribe() of this
   * Subscription. Can also be used to add a child subscription.
   *
   * If the tear down being added is a subscription that is already
   * unsubscribed, is the same reference `add` is being called on, or is
   * `Subscription.EMPTY`, it will not be added.
   *
   * If this subscription is already in an `closed` state, the passed
   * tear down logic will be executed immediately.
   *
   * When a parent subscription is unsubscribed, any child subscriptions that were added to it are also unsubscribed.
   *
   * @param {TeardownLogic} teardown The additional logic to execute on
   * teardown.
   * @return {Subscription} Returns the Subscription used or created to be
   * added to the inner subscriptions list. This Subscription can be used with
   * `remove()` to remove the passed teardown logic from the inner subscriptions
   * list.
   */
  add(teardown: TeardownLogic): Subscription {
    let subscription = (<Subscription>teardown);
    switch (typeof teardown) {
      case 'function':
        subscription = new Subscription(<(() => void)>teardown);
      case 'object':
        if (subscription === this || subscription.closed || typeof subscription.unsubscribe !== 'function') {
          // This also covers the case where `subscription` is `Subscription.EMPTY`, which is always in `closed` state.
          return subscription;
        } else if (this.closed) {
          subscription.unsubscribe();
          return subscription;
        } else if (!(subscription instanceof Subscription)) {
          const tmp = subscription;
          subscription = new Subscription();
          subscription._subscriptions = [tmp];
        }
        break;
      default: {
        if (!(<any>teardown)) {
          return Subscription.EMPTY;
        }
        throw new Error('unrecognized teardown ' + teardown + ' added to Subscription.');
      }
    }

    let { _parents } = subscription;
    if (_parents && _parents.indexOf(this) > -1) { return subscription; }
    if (_parents === null) {
      subscription._parents = [this];
    } else {
      _parents.push(this);
    }

    // Optimize for the common case when adding the first subscription.
    const subscriptions = this._subscriptions;
    if (subscriptions === null) {
      this._subscriptions = [subscription];
    } else {
      subscriptions.push(subscription);
    }

    return subscription;
  }

  /**
   * Removes a Subscription from the internal list of subscriptions that will
   * unsubscribe during the unsubscribe process of this Subscription.
   * @param {Subscription} subscription The subscription to remove.
   * @return {void}
   */
  remove(subscription: Subscription): void {
    const subscriptions = this._subscriptions;
    if (subscriptions) {
      const subscriptionIndex = subscriptions.indexOf(subscription);
      if (subscriptionIndex !== -1) {
        subscriptions.splice(subscriptionIndex, 1);
      }
    }
  }
}

function flattenUnsubscriptionErrors(errors: any[]) {
 return errors.reduce((errs, err) => errs.concat((err instanceof UnsubscriptionError) ? err.errors : err), []);
}
